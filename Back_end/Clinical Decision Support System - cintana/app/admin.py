"""
sqladmin Admin views + Authentication.

Provides a protected admin UI at /admin/ backed by SQLAlchemy + MySQL.
Login credentials are read from .env: ADMIN_USERNAME / ADMIN_PASSWORD
"""

from sqladmin import ModelView
from sqladmin.authentication import AuthenticationBackend
from starlette.requests import Request
from markupsafe import Markup
from wtforms import Form, StringField, TextAreaField
from wtforms.validators import DataRequired, Optional as WTOptional


class _DrugInteractionForm(Form):
    """Custom form — bypasses sqladmin FK auto-detection for drug_id."""
    drug_id               = StringField("Drug A — DrugBank ID (e.g. DB00001)",        validators=[DataRequired()], render_kw={"style": "width: 420px;"})
    drug_name             = StringField("Drug A — Drug Name",                          validators=[WTOptional()], render_kw={"style": "width: 420px;"})
    interacting_drug_id   = StringField("Drug B — DrugBank ID (e.g. DB00006)",        validators=[DataRequired()], render_kw={"style": "width: 420px;"})
    interacting_drug_name = StringField("Drug B — Drug Name",                          validators=[WTOptional()], render_kw={"style": "width: 420px;"})
    severity              = StringField("Severity (major / moderate / minor)",         validators=[WTOptional()], render_kw={"style": "width: 420px;"})
    description           = TextAreaField("Interaction Description",                    validators=[WTOptional()],
                                          render_kw={"rows": "10", "style": "width:100%;min-height:180px;font-size:0.9em"})


class _DrugProteinInteractionInlineForm(Form):
    """
    Inline form cho drug_protein_interactions trong Drug edit page.
    Dùng protein_id (integer) thay vì Select2 dropdown để tránh load 5,206 proteins.
    Admin nhập protein_id trực tiếp (có thể tra cứu từ trang Proteins).
    """
    protein_id       = StringField(
        "Protein ID (so nguyen — tra cuu tai /admin/protein/list)",
        validators=[DataRequired()],
        render_kw={"style": "width: 200px;", "placeholder": "e.g. 1"},
    )
    uniprot_id       = StringField(
        "UniProt ID (tuy chon, e.g. P04637)",
        validators=[WTOptional()],
        render_kw={"style": "width: 200px;"},
    )
    interaction_type = StringField(
        "Loai tuong tac (target / enzyme / transporter / carrier)",
        validators=[WTOptional()],
        render_kw={"style": "width: 200px;", "placeholder": "target"},
    )
    known_action     = StringField(
        "Known action (yes / no / unknown)",
        validators=[WTOptional()],
        render_kw={"style": "width: 120px;", "placeholder": "unknown"},
    )

from app.models import (
    Drug, DrugInteraction, Protein, User, AnalysisSession,
    DrugSynonym, DrugProduct, DrugExternalIdentifier, DrugCalculatedProperty,
    DrugFoodInteraction, DrugDosage, DrugGroupMap, DrugCategoryMap,
    DrugGroup, DrugCategory, DrugProteinInteraction, SystemMetadata,
)
from app.config import get_settings
from app.core.simple_cache import cache_delete_prefix, cache_delete


# ── Cache invalidation mixin ──────────────────────────────────────────────────
# Mọi thay đổi trong admin (thêm/sửa/xóa) sẽ tự động xóa cache liên quan,
# đảm bảo trang chính cập nhật ngay lập tức — không phải đợi 5-10 phút TTL.

class CacheInvalidatingAdmin:
    """
    Mixin cho ModelView của sqladmin. Tự động clear cache backend mỗi khi
    admin thêm/sửa/xóa bản ghi → trang chính (frontend) thấy thay đổi ngay.

    Xóa toàn bộ cache prefix:
      - drugs:list:    → danh sách thuốc (DrugsPage, Header search)
      - drugs:detail:  → chi tiết thuốc (DrugDetailPage)
      - drugs:cat:     → thuốc theo nhóm bệnh (InteractionsPage sidebar)
      - drugs:network: → mạng lưới protein (DrugDetailPage tab Network)
      - proteins:list:    → danh sách protein (ProteinsPage)
      - proteins:detail:  → chi tiết protein
      - sessions:stats:   → thống kê phiên phân tích
      - system:stats      → thống kê tổng (HomePage badge)
    """

    async def _invalidate_all_caches(self) -> None:
        """Xóa toàn bộ cache khiến trang chính phải fetch lại data mới."""
        try:
            for prefix in (
                "drugs:list:",
                "drugs:detail:",
                "drugs:cat:",
                "drugs:network:",
                "proteins:list:",
                "proteins:detail:",
                "sessions:stats:",
            ):
                cache_delete_prefix(prefix)
            cache_delete("system:stats")
            # Cũng clear FastAPICache (cdss-cache prefix dùng cho route khác)
            try:
                from fastapi_cache import FastAPICache
                backend = FastAPICache.get_backend()
                if backend is not None:
                    await backend.clear(namespace="cdss-cache")
            except Exception:
                pass
        except Exception:
            # Không bao giờ làm fail thao tác save vì lỗi clear cache
            pass

    async def after_model_change(self, data, model, is_created, request) -> None:  # type: ignore[override]
        """Hook của sqladmin — gọi sau khi INSERT/UPDATE thành công."""
        await self._invalidate_all_caches()
        # Gọi parent nếu có
        parent_hook = getattr(super(), "after_model_change", None)
        if parent_hook is not None:
            try:
                await parent_hook(data, model, is_created, request)
            except Exception:
                pass

    async def after_model_delete(self, model, request) -> None:  # type: ignore[override]
        """Hook của sqladmin — gọi sau khi DELETE thành công."""
        await self._invalidate_all_caches()
        parent_hook = getattr(super(), "after_model_delete", None)
        if parent_hook is not None:
            try:
                await parent_hook(model, request)
            except Exception:
                pass


# ── Authentication ────────────────────────────────────────────────────────────

class AdminAuth(AuthenticationBackend):
    async def login(self, request: Request) -> bool:
        settings = get_settings()
        form = await request.form()
        username = form.get("username", "")
        password = form.get("password", "")
        if username == settings.admin_username and password == settings.admin_password:
            request.session.update({"admin_authenticated": True})
            return True
        return False

    async def logout(self, request: Request) -> bool:
        request.session.clear()
        return True

    async def authenticate(self, request: Request) -> bool:
        return request.session.get("admin_authenticated", False)


# ── Module-level formatter functions (with try/except to prevent 500) ─────────

def _fmt_groups(m, a):
    try:
        maps = list(m.group_maps)
        if not maps:
            return Markup("<em style='color:#94a3b8'>No groups assigned</em>")
        parts = []
        for gm in maps:
            try:
                grp = gm.group
                name = grp.name if grp else f"group_{gm.group_id}"
            except Exception:
                name = f"group_{gm.group_id}"
            if name == "approved":
                style = "background:#dcfce7;color:#166534"
            elif name == "withdrawn":
                style = "background:#fee2e2;color:#991b1b"
            elif name in ("investigational", "experimental"):
                style = "background:#dbeafe;color:#1e40af"
            else:
                style = "background:#f3f4f6;color:#374151"
            parts.append(
                f'<span style="display:inline-block;padding:2px 10px;margin:2px;'
                f'border-radius:12px;font-size:0.82em;font-weight:600;{style}">{name}</span>'
            )
        return Markup(" ".join(parts))
    except Exception as e:
        return Markup(f"<em style='color:#dc2626'>Error loading groups: {e}</em>")


def _fmt_categories(m, a):
    try:
        maps = list(m.category_maps)
        if not maps:
            return Markup("<em style='color:#94a3b8'>No categories assigned</em>")
        items = []
        for cm in maps[:50]:
            try:
                name = cm.category.category if cm.category else f"cat_{cm.category_id}"
            except Exception:
                name = f"cat_{cm.category_id}"
            items.append(f'<span style="white-space:nowrap">{name}</span>')
        extra = f"... (+{len(maps) - 50} more)" if len(maps) > 50 else ""
        return Markup(
            f'<div style="max-height:160px;overflow-y:auto">{", ".join(items)}{extra}</div>'
        )
    except Exception as e:
        return Markup(f"<em style='color:#dc2626'>Error loading categories: {e}</em>")


def _fmt_synonyms(m, a):
    try:
        syns = list(m.synonyms_rel)
        if not syns:
            return Markup("<em style='color:#94a3b8'>No synonyms</em>")
        chips = "".join(
            f'<span style="display:inline-block;background:#f8fafc;border:1px solid #e2e8f0;'
            f'border-radius:4px;padding:1px 6px;margin:2px">{s.synonym}</span>'
            for s in syns[:60]
        )
        extra = f' <em style="color:#94a3b8">+{len(syns) - 60} more</em>' if len(syns) > 60 else ""
        return Markup(
            f'<div style="max-height:160px;overflow-y:auto;font-size:0.88em">{chips}{extra}</div>'
        )
    except Exception as e:
        return Markup(f"<em style='color:#dc2626'>Error: {e}</em>")


def _fmt_food(m, a):
    try:
        items = list(m.food_interactions_rel)
        if not items:
            return Markup("<em style='color:#94a3b8'>No food interactions recorded</em>")
        li = "".join(f'<li style="margin-bottom:4px">{fi.interaction}</li>' for fi in items)
        return Markup(
            f'<ul style="margin:0;padding-left:18px;font-size:0.88em;max-height:200px;overflow-y:auto">{li}</ul>'
        )
    except Exception as e:
        return Markup(f"<em style='color:#dc2626'>Error: {e}</em>")


def _fmt_dosages(m, a):
    try:
        dos = list(m.dosages_rel)[:30]
        if not dos:
            return Markup("<em style='color:#94a3b8'>No dosages recorded</em>")
        rows = "".join(
            f'<tr style="border-bottom:1px solid #e2e8f0">'
            f'<td style="padding:4px 8px">{d.form or "—"}</td>'
            f'<td style="padding:4px 8px">{d.route or "—"}</td>'
            f'<td style="padding:4px 8px">{d.strength or "—"}</td>'
            f'</tr>'
            for d in dos
        )
        note = '<div style="font-size:0.78em;color:#94a3b8">Showing up to 30 rows</div>' if len(dos) == 30 else ""
        return Markup(
            '<table style="width:100%;border-collapse:collapse;font-size:0.82em">'
            '<thead><tr>'
            '<th style="text-align:left;padding:4px 8px;background:#f1f5f9;color:#475569">Form</th>'
            '<th style="text-align:left;padding:4px 8px;background:#f1f5f9;color:#475569">Route</th>'
            '<th style="text-align:left;padding:4px 8px;background:#f1f5f9;color:#475569">Strength</th>'
            f'</tr></thead><tbody>{rows}</tbody></table>{note}'
        )
    except Exception as e:
        return Markup(f"<em style='color:#dc2626'>Error: {e}</em>")


def _fmt_products(m, a):
    try:
        prods = list(m.products_rel)[:20]
        if not prods:
            return Markup('<em style="color:#94a3b8">No brand names in database</em>')
        rows = "".join(
            f'<tr style="border-bottom:1px solid #e2e8f0">'
            f'<td style="padding:4px 8px;font-weight:600;color:#1e293b">{p.name or "—"}</td>'
            f'<td style="padding:4px 8px;color:#64748b">{p.labeller or "—"}</td>'
            f'<td style="padding:4px 8px;color:#64748b">{p.dosage_form or "—"}</td>'
            f'<td style="padding:4px 8px;color:#64748b">{p.country or "—"}</td>'
            f'</tr>'
            for p in prods
        )
        note = '<div style="font-size:0.78em;color:#94a3b8;margin-top:4px">Showing first 20 — see Drug Products section for full list</div>' if len(prods) == 20 else ""
        return Markup(
            '<table style="width:100%;border-collapse:collapse;font-size:0.82em">'
            '<thead><tr>'
            '<th style="text-align:left;padding:4px 8px;background:#f1f5f9;color:#475569;font-weight:700">Brand Name</th>'
            '<th style="text-align:left;padding:4px 8px;background:#f1f5f9;color:#475569;font-weight:700">Manufacturer</th>'
            '<th style="text-align:left;padding:4px 8px;background:#f1f5f9;color:#475569;font-weight:700">Form</th>'
            '<th style="text-align:left;padding:4px 8px;background:#f1f5f9;color:#475569;font-weight:700">Country</th>'
            f'</tr></thead><tbody>{rows}</tbody></table>{note}'
        )
    except Exception as e:
        return Markup(f"<em style='color:#dc2626'>Error: {e}</em>")


def _fmt_protein_interactions(m, a):
    """Hiển thị danh sách protein interactions trong detail view của Drug."""
    try:
        dpis = list(m.drug_protein_interactions_rel)[:30]
        if not dpis:
            return Markup("<em style='color:#94a3b8'>No protein interactions recorded</em>")

        TYPE_STYLE = {
            "target":      "background:#dbeafe;color:#1e40af",
            "enzyme":      "background:#dcfce7;color:#166534",
            "transporter": "background:#ede9fe;color:#5b21b6",
            "carrier":     "background:#fef3c7;color:#92400e",
        }
        rows = ""
        for dpi in dpis:
            itype = dpi.interaction_type or "target"
            style = TYPE_STYLE.get(itype, "background:#f3f4f6;color:#374151")
            protein_name = ""
            try:
                protein_name = dpi.protein.name if dpi.protein else ""
            except Exception:
                pass
            rows += (
                f'<tr style="border-bottom:1px solid #e2e8f0">'
                f'<td style="padding:4px 8px;font-family:monospace;font-size:0.82em">{dpi.protein_id}</td>'
                f'<td style="padding:4px 8px;font-size:0.82em">{dpi.uniprot_id or "—"}</td>'
                f'<td style="padding:4px 8px;font-size:0.82em">{protein_name[:60] or "—"}</td>'
                f'<td style="padding:4px 8px">'
                f'<span style="padding:2px 8px;border-radius:10px;font-size:0.78em;font-weight:600;{style}">{itype}</span>'
                f'</td>'
                f'<td style="padding:4px 8px;font-size:0.82em">{dpi.known_action or "—"}</td>'
                f'</tr>'
            )
        note = f'<div style="font-size:0.78em;color:#94a3b8;margin-top:4px">Showing first 30 of {len(list(m.drug_protein_interactions_rel))} records</div>' if len(list(m.drug_protein_interactions_rel)) > 30 else ""
        return Markup(
            '<table style="width:100%;border-collapse:collapse;font-size:0.82em">'
            '<thead><tr>'
            '<th style="text-align:left;padding:4px 8px;background:#f1f5f9;color:#475569">Protein ID</th>'
            '<th style="text-align:left;padding:4px 8px;background:#f1f5f9;color:#475569">UniProt ID</th>'
            '<th style="text-align:left;padding:4px 8px;background:#f1f5f9;color:#475569">Protein Name</th>'
            '<th style="text-align:left;padding:4px 8px;background:#f1f5f9;color:#475569">Type</th>'
            '<th style="text-align:left;padding:4px 8px;background:#f1f5f9;color:#475569">Known Action</th>'
            f'</tr></thead><tbody>{rows}</tbody></table>{note}'
        )
    except Exception as e:
        return Markup(f"<em style='color:#dc2626'>Error: {e}</em>")


# ── Model Views ───────────────────────────────────────────────────────────────

class DrugAdmin(CacheInvalidatingAdmin, ModelView, model=Drug):
    name = "Drug"
    name_plural = "Drugs"
    icon = "fa-solid fa-capsules"

    can_create = False   # Dùng Wizard thay thế — nút "Thêm thuốc (Wizard)" ở header
    can_export = True
    export_types = ["csv", "json"]
    export_max_rows = 0   # không giới hạn (17k rows — OK)

    # ── List view ─────────────────────────────────────────────────────────────
    column_list = [
        Drug.drugbank_id,
        Drug.name,
        Drug.drug_type,
        Drug.state,
        Drug.cas_number,
        Drug.molecular_formula,
        Drug.average_mass,
        Drug.atc_codes,
    ]

    column_searchable_list = [Drug.name, Drug.drugbank_id, Drug.cas_number]
    column_sortable_list = [Drug.drugbank_id, Drug.name, Drug.drug_type, Drug.state, Drug.average_mass]

    page_size = 25
    page_size_options = [10, 25, 50, 100]

    # Allow editing the primary key field (drugbank_id) in create form
    form_include_pk = True

    # ── Eager-load all relationships used in detail view ─────────────────────
    # Prevents DetachedInstanceError when sqladmin closes session before rendering
    def get_query(self):
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload
        return (
            select(Drug)
            .options(
                selectinload(Drug.group_maps).selectinload(DrugGroupMap.group),
                selectinload(Drug.category_maps).selectinload(DrugCategoryMap.category),
                selectinload(Drug.synonyms_rel),
                selectinload(Drug.food_interactions_rel),
                selectinload(Drug.dosages_rel),
                selectinload(Drug.products_rel),
                selectinload(Drug.drug_protein_interactions_rel),
            )
        )

    def get_count_query(self):
        from sqlalchemy import select, func
        return select(func.count()).select_from(Drug)

    # ── Detail view — tất cả fields ───────────────────────────────────────────
    column_details_list = [
        Drug.drugbank_id,
        Drug.name,
        Drug.drug_type,
        Drug.cas_number,
        Drug.unii,
        Drug.atc_codes,
        Drug.state,
        # Classification
        Drug.group_maps,
        Drug.category_maps,
        # Chemical
        Drug.molecular_formula,
        Drug.average_mass,
        Drug.monoisotopic_mass,
        Drug.smiles,
        Drug.inchi,
        Drug.inchikey,
        # Pharmacology
        Drug.description,
        Drug.indication,
        Drug.pharmacodynamics,
        Drug.mechanism_of_action,
        Drug.toxicity,
        Drug.absorption,
        Drug.metabolism,
        Drug.half_life,
        Drug.protein_binding,
        Drug.route_of_elimination,
        # Related data
        Drug.synonyms_rel,
        Drug.food_interactions_rel,
        Drug.dosages_rel,
        Drug.products_rel,
        Drug.drug_protein_interactions_rel,
        # Timestamps
        Drug.created_at,
        Drug.updated_at,
    ]

    # ── Inline sub-forms (shown inside Drug create/edit page) ────────────────
    # 7 bảng liên quan đều có thể thêm/sửa/xóa trực tiếp trong form thuốc:
    #   1. drug_synonyms          — tên đồng nghĩa
    #   2. drug_products          — sản phẩm thương mại / brand names
    #   3. drug_food_interactions — tương tác thức ăn
    #   4. drug_dosages           — liều dùng
    #   5. drug_protein_interactions — liên kết protein (target/enzyme/transporter/carrier)
    # Còn drug_group_map và drug_category_map được xử lý qua form_columns M2M select bên dưới
    inline_models = [
        DrugSynonym,
        DrugProduct,
        DrugFoodInteraction,
        DrugDosage,
        (DrugProteinInteraction, {
            "form_columns": ["protein_id", "uniprot_id", "interaction_type", "known_action"],
            "column_labels": {
                "protein_id":       "Protein ID (so nguyen)",
                "uniprot_id":       "UniProt ID",
                "interaction_type": "Loai (target/enzyme/transporter/carrier)",
                "known_action":     "Known Action (yes/no/unknown)",
            },
        }),
    ]

    # ── Form (create/edit) — scalar columns + M2M selects ────────────────────
    form_columns = [
        Drug.drugbank_id,
        Drug.name,
        Drug.drug_type,
        Drug.cas_number,
        Drug.unii,
        Drug.atc_codes,
        Drug.state,
        Drug.molecular_formula,
        Drug.average_mass,
        Drug.monoisotopic_mass,
        Drug.smiles,
        Drug.inchi,
        Drug.inchikey,
        Drug.description,
        Drug.indication,
        Drug.pharmacodynamics,
        Drug.mechanism_of_action,
        Drug.toxicity,
        Drug.metabolism,
        Drug.absorption,
        Drug.half_life,
        Drug.protein_binding,
        Drug.route_of_elimination,
        # M2M: groups và categories — sqladmin render multi-select
        Drug.group_maps,
        Drug.category_maps,
    ]

    # ── Column labels (hiển thị tên đẹp hơn) ─────────────────────────────────
    column_labels = {
        Drug.drugbank_id: "DrugBank ID",
        Drug.drug_type: "Type",
        Drug.cas_number: "CAS Number",
        Drug.atc_codes: "ATC Codes",
        Drug.molecular_formula: "Formula",
        Drug.average_mass: "Avg Mass (Da)",
        Drug.monoisotopic_mass: "Monoisotopic Mass (Da)",
        Drug.inchikey: "InChIKey",
        Drug.mechanism_of_action: "Mechanism of Action",
        Drug.route_of_elimination: "Route of Elimination",
        Drug.protein_binding: "Protein Binding",
        Drug.pharmacodynamics: "Pharmacodynamics",
        Drug.group_maps: "Groups (Approval Status)",
        Drug.category_maps: "Categories (Disease Groups)",
        Drug.synonyms_rel: "Synonyms / Aliases",
        Drug.food_interactions_rel: "Food Interactions",
        Drug.dosages_rel: "Dosages",
        Drug.products_rel: "Brand Names / Products",
        Drug.drug_protein_interactions_rel: "Protein Interactions (Targets / Enzymes / Transporters)",
    }

    # ── Formatter: hiển thị cấu trúc hóa học từ PubChem qua SMILES/InChIKey ──
    column_formatters_detail = {
        Drug.smiles: lambda m, a: Markup(
            f'<code style="word-break:break-all;font-size:0.8em">{m.smiles}</code>'
            + (
                f'<br><img src="https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/'
                f'{m.smiles}/PNG?image_size=300x200" '
                f'style="margin-top:8px;border:1px solid #e2e8f0;border-radius:6px" '
                f'onerror="this.style.display=\'none\'" />'
                if m.smiles else ""
            )
        ) if m.smiles else Markup("<em>N/A</em>"),
        Drug.description: lambda m, a: Markup(
            f'<div style="max-height:200px;overflow-y:auto;font-size:0.9em">{m.description}</div>'
        ) if m.description else "",
        Drug.indication: lambda m, a: Markup(
            f'<div style="max-height:150px;overflow-y:auto;font-size:0.9em">{m.indication}</div>'
        ) if m.indication else "",
        Drug.mechanism_of_action: lambda m, a: Markup(
            f'<div style="max-height:150px;overflow-y:auto;font-size:0.9em">{m.mechanism_of_action}</div>'
        ) if m.mechanism_of_action else "",
        Drug.toxicity: lambda m, a: Markup(
            f'<div style="max-height:150px;overflow-y:auto;font-size:0.9em">{m.toxicity}</div>'
        ) if m.toxicity else "",
        # Relationships — use module-level functions (try/except, no 500)
        "group_maps":                       _fmt_groups,
        "category_maps":                    _fmt_categories,
        "synonyms_rel":                     _fmt_synonyms,
        "food_interactions_rel":            _fmt_food,
        "dosages_rel":                      _fmt_dosages,
        "products_rel":                     _fmt_products,
        "drug_protein_interactions_rel":    _fmt_protein_interactions,
    }

    column_formatters = {
        Drug.state: lambda m, a: Markup(
            f'<span style="padding:2px 8px;border-radius:12px;font-size:0.8em;font-weight:600;'
            + ("background:#dcfce7;color:#166534" if m.state == "solid"
               else "background:#dbeafe;color:#1e40af" if m.state == "liquid"
               else "background:#fef9c3;color:#854d0e" if m.state == "gas"
               else "background:#f3f4f6;color:#374151")
            + f'">{m.state or "—"}</span>'
        ),
        Drug.drug_type: lambda m, a: Markup(
            f'<span style="padding:2px 8px;border-radius:12px;font-size:0.8em;font-weight:600;'
            + ("background:#ede9fe;color:#5b21b6" if m.drug_type == "biotech"
               else "background:#ffedd5;color:#9a3412")
            + f'">{m.drug_type or "—"}</span>'
        ),
    }


class DrugInteractionAdmin(CacheInvalidatingAdmin, ModelView, model=DrugInteraction):
    name = "Drug Interaction"
    name_plural = "Drug Interactions"
    icon = "fa-solid fa-triangle-exclamation"

    can_create = True
    can_edit = True
    can_delete = True
    # Export sqladmin mặc định bị giới hạn với 2.8M rows → dùng endpoint streaming riêng
    # Xem: GET /api/v1/export/interactions  và  GET /api/v1/export/interactions/unique
    can_export = False

    column_list = [
        DrugInteraction.id,
        DrugInteraction.drug_id,
        DrugInteraction.interacting_drug_id,
        DrugInteraction.interacting_drug_name,
        DrugInteraction.severity,
    ]

    column_searchable_list = [
        DrugInteraction.drug_id,
        DrugInteraction.interacting_drug_id,
        DrugInteraction.interacting_drug_name,
        DrugInteraction.severity,
    ]

    column_sortable_list = [DrugInteraction.drug_id, DrugInteraction.severity, DrugInteraction.id]

    column_details_list = [
        DrugInteraction.id,
        DrugInteraction.drug_id,
        "drug_name",
        DrugInteraction.interacting_drug_id,
        DrugInteraction.interacting_drug_name,
        DrugInteraction.severity,
        DrugInteraction.description,
        DrugInteraction.created_at,
        DrugInteraction.updated_at,
    ]

    # Custom form — 6 trường plain text, không có Select2 dropdown
    form = _DrugInteractionForm

    page_size = 50
    page_size_options = [20, 50, 100, 200]

    column_labels = {
        DrugInteraction.drug_id:              "Drug A — DrugBank ID",
        "drug_name":                          "Drug A — Name",
        DrugInteraction.interacting_drug_id:  "Drug B — DrugBank ID",
        DrugInteraction.interacting_drug_name: "Drug B — Name",
        DrugInteraction.severity:             "Severity",
        DrugInteraction.description:          "Interaction Description",
    }

    column_formatters = {
        DrugInteraction.drug_id: lambda m, a: Markup(
            f'<span style="font-family:monospace;font-size:0.82em;font-weight:700;color:#1d4ed8">{m.drug_id}</span>'
        ),
        DrugInteraction.interacting_drug_id: lambda m, a: Markup(
            f'<span style="font-family:monospace;font-size:0.82em;font-weight:700;color:#0f766e">{m.interacting_drug_id}</span>'
        ),
        DrugInteraction.severity: lambda m, a: Markup(
            f'<span style="padding:2px 10px;border-radius:12px;font-size:0.82em;font-weight:700;'
            + ("background:#fee2e2;color:#991b1b" if m.severity == "major"
               else "background:#fef3c7;color:#92400e" if m.severity == "moderate"
               else "background:#dcfce7;color:#166534" if m.severity == "minor"
               else "background:#f3f4f6;color:#374151")
            + f'">{(m.severity or "unknown").upper()}</span>'
        ),
    }

    column_formatters_detail = {
        DrugInteraction.drug_id: lambda m, a: Markup(
            f'<span style="font-family:monospace;font-weight:700;color:#1d4ed8">{m.drug_id}</span>'
        ),
        DrugInteraction.interacting_drug_id: lambda m, a: Markup(
            f'<span style="font-family:monospace;font-weight:700;color:#0f766e">{m.interacting_drug_id}</span>'
        ),
        DrugInteraction.description: lambda m, a: Markup(
            f'<div style="max-height:200px;overflow-y:auto;font-size:0.9em;line-height:1.6">{m.description}</div>'
        ) if m.description else "\u2014",
        DrugInteraction.severity: lambda m, a: Markup(
            f'<span style="padding:3px 12px;border-radius:12px;font-size:0.9em;font-weight:700;'
            + ("background:#fee2e2;color:#991b1b" if m.severity == "major"
               else "background:#fef3c7;color:#92400e" if m.severity == "moderate"
               else "background:#dcfce7;color:#166534" if m.severity == "minor"
               else "background:#f3f4f6;color:#374151")
            + f'">{(m.severity or "unknown").upper()}</span>'
        ),
    }


class ProteinAdmin(CacheInvalidatingAdmin, ModelView, model=Protein):
    name = "Protein"
    name_plural = "Proteins"
    icon = "fa-solid fa-dna"

    can_create = True
    can_edit = True
    can_delete = False
    can_export = True
    export_types = ["csv", "json"]
    export_max_rows = 0

    column_list = [
        Protein.id,
        Protein.uniprot_id,
        Protein.name,
        Protein.gene_name,
        Protein.protein_type,
        Protein.organism,
        Protein.entrez_gene_id,
    ]

    column_searchable_list = [Protein.name, Protein.gene_name, Protein.uniprot_id]
    column_sortable_list = [Protein.id, Protein.name, Protein.gene_name, Protein.protein_type, Protein.organism]

    column_details_list = [
        Protein.id,
        Protein.uniprot_id,
        Protein.entrez_gene_id,
        Protein.name,
        Protein.gene_name,
        Protein.protein_type,
        Protein.organism,
        Protein.general_function,
        Protein.specific_function,
        Protein.created_at,
        Protein.updated_at,
    ]

    form_columns = [
        Protein.uniprot_id,
        Protein.entrez_gene_id,
        Protein.name,
        Protein.gene_name,
        Protein.protein_type,
        Protein.organism,
        Protein.general_function,
        Protein.specific_function,
    ]

    page_size = 50
    page_size_options = [20, 50, 100]

    column_labels = {
        Protein.uniprot_id: "UniProt ID",
        Protein.entrez_gene_id: "Entrez Gene ID",
        Protein.gene_name: "Gene Name",
        Protein.protein_type: "Type",
        Protein.general_function: "General Function",
        Protein.specific_function: "Specific Function",
    }

    column_formatters = {
        Protein.protein_type: lambda m, a: Markup(
            f'<span style="padding:2px 8px;border-radius:12px;font-size:0.82em;font-weight:600;'
            + ("background:#dbeafe;color:#1e40af" if m.protein_type == "target"
               else "background:#dcfce7;color:#166534" if m.protein_type == "enzyme"
               else "background:#ede9fe;color:#5b21b6" if m.protein_type == "transporter"
               else "background:#fef3c7;color:#92400e" if m.protein_type == "carrier"
               else "background:#f3f4f6;color:#374151")
            + f'">{m.protein_type or "—"}</span>'
        ),
    }

    column_formatters_detail = {
        Protein.general_function: lambda m, a: Markup(
            f'<div style="max-height:150px;overflow-y:auto;font-size:0.9em">{m.general_function}</div>'
        ) if m.general_function else "—",
        Protein.specific_function: lambda m, a: Markup(
            f'<div style="max-height:200px;overflow-y:auto;font-size:0.9em">{m.specific_function}</div>'
        ) if m.specific_function else "—",
    }


class UserAdmin(CacheInvalidatingAdmin, ModelView, model=User):
    name = "User"
    name_plural = "Users"
    icon = "fa-solid fa-users"

    can_create = False
    can_edit = True
    can_delete = True

    # ── List view: thông tin chính ─────────────────────────────────────────
    column_list = [
        User.id,
        User.full_name,
        User.username,
        User.email,
        User.is_active,
        User.is_admin,
        User.last_login,
        User.created_at,
    ]

    # ── Detail view: đầy đủ bao gồm token ─────────────────────────────────
    column_details_list = [
        User.id,
        User.full_name,
        User.username,
        User.email,
        User.hashed_password,   # masked
        User.avatar_color,
        User.is_active,
        User.is_admin,
        User.last_login,
        User.last_token,        # JWT token (masked)
        User.created_at,
        User.updated_at,
    ]

    column_searchable_list = [User.username, User.email, User.full_name]
    column_sortable_list = [User.id, User.username, User.created_at, User.last_login, User.is_active]

    form_columns = [
        User.username,
        User.email,
        User.full_name,
        User.is_active,
        User.is_admin,
        User.avatar_color,
    ]

    page_size = 50

    column_labels = {
        User.full_name: "Full Name",
        User.hashed_password: "Password",
        User.is_active: "Active",
        User.is_admin: "Admin",
        User.last_login: "Last Login",
        User.last_token: "Last Token",
        User.avatar_color: "Avatar Color",
        User.created_at: "Registered At",
    }

    column_formatters = {
        User.is_active: lambda m, a: Markup(
            '<span style="padding:2px 8px;border-radius:12px;font-size:0.82em;font-weight:600;background:#dcfce7;color:#166534">Active</span>'
            if m.is_active else
            '<span style="padding:2px 8px;border-radius:12px;font-size:0.82em;font-weight:600;background:#fee2e2;color:#991b1b">Inactive</span>'
        ),
        User.is_admin: lambda m, a: Markup(
            '<span style="padding:2px 8px;border-radius:12px;font-size:0.82em;font-weight:600;background:#ede9fe;color:#5b21b6">Admin</span>'
            if m.is_admin else
            '<span style="padding:2px 8px;border-radius:12px;font-size:0.82em;font-weight:600;background:#f3f4f6;color:#6b7280">User</span>'
        ),
        User.avatar_color: lambda m, a: Markup(
            f'<span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:{m.avatar_color};vertical-align:middle;margin-right:4px"></span>{m.avatar_color}'
        ) if m.avatar_color else "—",
    }

    column_formatters_detail = {
        User.hashed_password: lambda m, a: Markup(
            '<span style="letter-spacing:3px;font-size:1.2em;color:#94a3b8">••••••••••••</span>'
            '<span style="font-size:11px;color:#94a3b8;margin-left:8px">(hashed, not shown for security)</span>'
        ),
        User.last_token: lambda m, a: (
            Markup(
                '<div style="font-family:monospace;font-size:12px;word-break:break-all;'
                'background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px;color:#374151">'
                + m.last_token[:40]
                + '<span style="color:#94a3b8">•••••••••••••••••••••</span>'
                + m.last_token[-8:]
                + '</div>'
                '<div style="font-size:11px;color:#94a3b8;margin-top:4px">JWT Bearer Token — copy \u0111\u1ec3 d\u00f9ng v\u1edbi API</div>'
            ) if m.last_token else Markup("<em style='color:#94a3b8'>Ch\u01b0a \u0111\u0103ng nh\u1eadp</em>")
        ),
        User.is_active: lambda m, a: Markup(
            '<span style="padding:3px 12px;border-radius:12px;font-size:0.9em;font-weight:600;background:#dcfce7;color:#166534">Active</span>'
            if m.is_active else
            '<span style="padding:3px 12px;border-radius:12px;font-size:0.9em;font-weight:600;background:#fee2e2;color:#991b1b">Inactive</span>'
        ),
        User.is_admin: lambda m, a: Markup(
            '<span style="padding:3px 12px;border-radius:12px;font-size:0.9em;font-weight:600;background:#ede9fe;color:#5b21b6">Admin</span>'
            if m.is_admin else
            '<span style="padding:3px 12px;border-radius:12px;font-size:0.9em;font-weight:600;background:#f3f4f6;color:#6b7280">User</span>'
        ),
        User.avatar_color: lambda m, a: Markup(
            f'<span style="display:inline-flex;align-items:center;gap:8px">'
            f'<span style="width:24px;height:24px;border-radius:50%;background:{m.avatar_color};border:2px solid #e2e8f0"></span>'
            f'<code>{m.avatar_color}</code></span>'
        ) if m.avatar_color else "—",
    }


class AnalysisSessionAdmin(CacheInvalidatingAdmin, ModelView, model=AnalysisSession):
    name = "Analysis Session"
    name_plural = "Analysis Sessions"
    icon = "fa-solid fa-chart-line"

    can_create = False
    can_edit = False
    can_delete = True

    column_list = [
        AnalysisSession.id,
        AnalysisSession.user_id,
        AnalysisSession.title,
        AnalysisSession.risk_level,
        AnalysisSession.risk_score,
        AnalysisSession.total_drugs,
        AnalysisSession.total_interactions,
        AnalysisSession.major_count,
        AnalysisSession.created_at,
    ]

    column_details_list = [
        AnalysisSession.id,
        AnalysisSession.user_id,
        AnalysisSession.title,
        AnalysisSession.tags,
        AnalysisSession.risk_level,
        AnalysisSession.risk_score,
        AnalysisSession.total_drugs,
        AnalysisSession.total_interactions,
        AnalysisSession.major_count,
        AnalysisSession.moderate_count,
        AnalysisSession.minor_count,
        AnalysisSession.notes,
        AnalysisSession.created_at,
        AnalysisSession.updated_at,
    ]

    column_searchable_list = [AnalysisSession.title, AnalysisSession.risk_level]
    column_sortable_list = [
        AnalysisSession.id,
        AnalysisSession.risk_score,
        AnalysisSession.created_at,
        AnalysisSession.total_interactions,
    ]

    page_size = 50
    page_size_options = [20, 50, 100]

    column_formatters = {
        AnalysisSession.risk_level: lambda m, a: Markup(
            f'<span style="padding:2px 10px;border-radius:12px;font-size:0.82em;font-weight:700;'
            + ("background:#fee2e2;color:#991b1b" if m.risk_level == "critical"
               else "background:#fed7aa;color:#9a3412" if m.risk_level == "high"
               else "background:#fef3c7;color:#92400e" if m.risk_level == "moderate"
               else "background:#dcfce7;color:#166534")
            + f'">{(m.risk_level or "low").upper()}</span>'
        ) if m.risk_level else "—",
    }


# ── Supporting table views ────────────────────────────────────────────────────

class DrugSynonymAdmin(CacheInvalidatingAdmin, ModelView, model=DrugSynonym):
    name = "Drug Synonym"
    name_plural = "Drug Synonyms"
    icon = "fa-solid fa-tag"

    can_create = True
    can_edit = True
    can_delete = True
    can_export = True
    export_types = ["csv", "json"]
    export_max_rows = 0

    column_list = [
        DrugSynonym.id,
        DrugSynonym.drug_id,
        DrugSynonym.synonym,
        DrugSynonym.language,
        DrugSynonym.coder,
    ]
    column_searchable_list = [DrugSynonym.drug_id, DrugSynonym.synonym]
    column_sortable_list = [DrugSynonym.id, DrugSynonym.drug_id]
    form_columns = [DrugSynonym.drug_id, DrugSynonym.synonym, DrugSynonym.language, DrugSynonym.coder]
    page_size = 50
    page_size_options = [20, 50, 100]


class DrugProductAdmin(CacheInvalidatingAdmin, ModelView, model=DrugProduct):
    name = "Drug Product"
    name_plural = "Drug Products"
    icon = "fa-solid fa-box"

    can_create = True
    can_edit = True
    can_delete = True
    can_export = True
    export_types = ["csv", "json"]
    export_max_rows = 0

    column_list = [
        DrugProduct.id,
        DrugProduct.drug_id,
        DrugProduct.name,
        DrugProduct.labeller,
        DrugProduct.dosage_form,
        DrugProduct.strength,
        DrugProduct.route,
        DrugProduct.country,
        DrugProduct.source,
    ]
    column_searchable_list = [DrugProduct.drug_id, DrugProduct.name, DrugProduct.labeller]
    column_sortable_list = [DrugProduct.id, DrugProduct.drug_id, DrugProduct.country]
    form_columns = [DrugProduct.drug_id, DrugProduct.name, DrugProduct.labeller, DrugProduct.ndc_id, DrugProduct.dosage_form, DrugProduct.strength, DrugProduct.route, DrugProduct.country, DrugProduct.source]
    page_size = 50
    page_size_options = [20, 50, 100]


class DrugExternalIdentifierAdmin(CacheInvalidatingAdmin, ModelView, model=DrugExternalIdentifier):
    name = "External Identifier"
    name_plural = "External Identifiers"
    icon = "fa-solid fa-link"

    can_create = True
    can_edit = True
    can_delete = True

    column_list = [
        DrugExternalIdentifier.id,
        DrugExternalIdentifier.drug_id,
        DrugExternalIdentifier.resource,
        DrugExternalIdentifier.identifier,
    ]
    column_searchable_list = [
        DrugExternalIdentifier.drug_id,
        DrugExternalIdentifier.resource,
        DrugExternalIdentifier.identifier,
    ]
    column_sortable_list = [DrugExternalIdentifier.id, DrugExternalIdentifier.drug_id, DrugExternalIdentifier.resource]
    form_columns = [DrugExternalIdentifier.drug_id, DrugExternalIdentifier.resource, DrugExternalIdentifier.identifier]
    page_size = 50
    page_size_options = [20, 50, 100]


class DrugCalculatedPropertyAdmin(CacheInvalidatingAdmin, ModelView, model=DrugCalculatedProperty):
    name = "Calculated Property"
    name_plural = "Calculated Properties"
    icon = "fa-solid fa-flask"

    can_create = True
    can_edit = True
    can_delete = True

    column_list = [
        DrugCalculatedProperty.id,
        DrugCalculatedProperty.drug_id,
        DrugCalculatedProperty.kind,
        DrugCalculatedProperty.value,
        DrugCalculatedProperty.source,
    ]
    column_searchable_list = [DrugCalculatedProperty.drug_id, DrugCalculatedProperty.kind]
    column_sortable_list = [DrugCalculatedProperty.id, DrugCalculatedProperty.drug_id, DrugCalculatedProperty.kind]
    form_columns = [DrugCalculatedProperty.drug_id, DrugCalculatedProperty.kind, DrugCalculatedProperty.value, DrugCalculatedProperty.source]
    page_size = 50
    page_size_options = [20, 50, 100]

    column_labels = {
        DrugCalculatedProperty.kind: "Property",
        DrugCalculatedProperty.value: "Value",
        DrugCalculatedProperty.source: "Source (Calculator)",
    }


class DrugFoodInteractionAdmin(CacheInvalidatingAdmin, ModelView, model=DrugFoodInteraction):
    name = "Food Interaction"
    name_plural = "Food Interactions"
    icon = "fa-solid fa-utensils"

    can_create = True
    can_edit = True
    can_delete = True

    column_list = [
        DrugFoodInteraction.id,
        DrugFoodInteraction.drug_id,
        DrugFoodInteraction.interaction,
    ]
    column_searchable_list = [DrugFoodInteraction.drug_id, DrugFoodInteraction.interaction]
    column_sortable_list = [DrugFoodInteraction.id, DrugFoodInteraction.drug_id]
    form_columns = [DrugFoodInteraction.drug_id, DrugFoodInteraction.interaction]
    page_size = 50
    page_size_options = [20, 50, 100]

    column_labels = {
        DrugFoodInteraction.drug_id: "DrugBank ID",
        DrugFoodInteraction.interaction: "Food/Drink Interaction",
    }


class DrugDosageAdmin(CacheInvalidatingAdmin, ModelView, model=DrugDosage):
    name = "Dosage"
    name_plural = "Dosages"
    icon = "fa-solid fa-prescription-bottle"

    can_create = True
    can_edit = True
    can_delete = True

    column_list = [
        DrugDosage.id,
        DrugDosage.drug_id,
        DrugDosage.form,
        DrugDosage.route,
        DrugDosage.strength,
    ]
    column_searchable_list = [DrugDosage.drug_id, DrugDosage.form, DrugDosage.route]
    column_sortable_list = [DrugDosage.id, DrugDosage.drug_id, DrugDosage.form]
    form_columns = [DrugDosage.drug_id, DrugDosage.form, DrugDosage.route, DrugDosage.strength]
    page_size = 50
    page_size_options = [20, 50, 100]

    column_labels = {
        DrugDosage.drug_id: "DrugBank ID",
        DrugDosage.form: "Dosage Form",
        DrugDosage.route: "Route of Administration",
        DrugDosage.strength: "Strength",
    }


class SystemMetadataAdmin(CacheInvalidatingAdmin, ModelView, model=SystemMetadata):
    """
    Admin view cho bảng system_metadata.
    Chỉ có 1 row (id=1) — admin chỉnh sửa phiên bản DrugBank tại đây.
    Thông tin này hiển thị trên website qua GET /api/v1/stats.
    """
    name = "System Metadata"
    name_plural = "System Metadata"
    icon = "fa-solid fa-database"

    can_create = False   # chỉ 1 row, không tạo thêm
    can_edit = True
    can_delete = False

    column_list = [
        SystemMetadata.id,
        SystemMetadata.drugbank_version,
        SystemMetadata.data_year,
        SystemMetadata.release_date,
        SystemMetadata.import_date,
        SystemMetadata.notes,
        SystemMetadata.updated_at,
    ]

    column_details_list = [
        SystemMetadata.id,
        SystemMetadata.drugbank_version,
        SystemMetadata.data_year,
        SystemMetadata.release_date,
        SystemMetadata.import_date,
        SystemMetadata.notes,
        SystemMetadata.created_at,
        SystemMetadata.updated_at,
    ]

    form_columns = [
        SystemMetadata.drugbank_version,
        SystemMetadata.data_year,
        SystemMetadata.release_date,
        SystemMetadata.import_date,
        SystemMetadata.notes,
    ]

    column_labels = {
        SystemMetadata.drugbank_version: "DrugBank Version (e.g. 5.1.12)",
        SystemMetadata.data_year:        "Data Year (e.g. 2026) — hien thi tren website",
        SystemMetadata.release_date:     "Release Date (YYYY-MM-DD)",
        SystemMetadata.import_date:      "Import Date (YYYY-MM-DD) — ngay admin import vao he thong",
        SystemMetadata.notes:            "Notes",
        SystemMetadata.updated_at:       "Last Updated",
    }

    column_formatters = {
        SystemMetadata.drugbank_version: lambda m, a: Markup(
            f'<span style="font-family:monospace;font-weight:700;font-size:1em;'
            f'background:#dbeafe;color:#1e40af;padding:3px 10px;border-radius:8px">'
            f'DrugBank v{m.drugbank_version}</span>'
        ),
        SystemMetadata.data_year: lambda m, a: Markup(
            f'<span style="font-family:monospace;font-weight:700;font-size:1em;'
            f'background:#dcfce7;color:#166534;padding:3px 10px;border-radius:8px">'
            f'{m.data_year}</span>'
        ),
    }

    column_formatters_detail = {
        SystemMetadata.drugbank_version: lambda m, a: Markup(
            f'<span style="font-family:monospace;font-weight:700;font-size:1.1em;'
            f'background:#dbeafe;color:#1e40af;padding:4px 14px;border-radius:8px">'
            f'DrugBank v{m.drugbank_version}</span>'
        ),
        SystemMetadata.data_year: lambda m, a: Markup(
            f'<span style="font-family:monospace;font-weight:700;font-size:1.1em;'
            f'background:#dcfce7;color:#166534;padding:4px 14px;border-radius:8px">'
            f'{m.data_year}</span>'
            f'<div style="font-size:0.78em;color:#94a3b8;margin-top:4px">'
            f'Gia tri nay hien thi tren trang chu website tai muc "Latest System"</div>'
        ),
        SystemMetadata.notes: lambda m, a: Markup(
            f'<div style="font-size:0.9em;line-height:1.6">{m.notes}</div>'
        ) if m.notes else Markup("<em style='color:#94a3b8'>No notes</em>"),
    }

    page_size = 10


# ─────────────────────────────────────────────────────────────────────────────
# Drug Groups  (bảng `groups` — 7 nhóm phê duyệt)
# ─────────────────────────────────────────────────────────────────────────────

class DrugGroupAdmin(CacheInvalidatingAdmin, ModelView, model=DrugGroup):
    """
    Quản lý bảng `groups`.
    Mỗi nhóm là 1 trạng thái phê duyệt của thuốc (approved, experimental, withdrawn, …).
    Sau khi thêm/sửa tên nhóm ở đây, bảng drug_group_map dùng group_id để gán thuốc vào nhóm.
    """
    name = "Drug Group"
    name_plural = "Drug Groups"
    icon = "fa-solid fa-layer-group"

    can_create = True
    can_edit   = True
    can_delete = False   # xóa group ảnh hưởng cascade tới drug_group_map

    column_list = [DrugGroup.id, DrugGroup.name]
    column_sortable_list = [DrugGroup.id, DrugGroup.name]
    column_searchable_list = [DrugGroup.name]
    form_columns = [DrugGroup.name]
    page_size = 20

    column_labels = {
        DrugGroup.id:   "ID (dùng trong drug_group_map)",
        DrugGroup.name: "Tên nhóm (approved / experimental / withdrawn / …)",
    }

    column_formatters = {
        DrugGroup.name: lambda m, a: Markup(
            f'<span style="padding:2px 10px;border-radius:12px;font-size:0.82em;font-weight:700;'
            + ("background:#dcfce7;color:#166534" if m.name == "approved"
               else "background:#fee2e2;color:#991b1b" if m.name == "withdrawn"
               else "background:#dbeafe;color:#1e40af" if m.name in ("investigational","experimental")
               else "background:#fef3c7;color:#92400e" if m.name == "illicit"
               else "background:#ede9fe;color:#5b21b6" if m.name == "nutraceutical"
               else "background:#f3f4f6;color:#374151")
            + f'">{m.name}</span>'
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Drug Group Map  (bảng `drug_group_map` — junction N-N: drugs ↔ groups)
# ─────────────────────────────────────────────────────────────────────────────

class DrugGroupMapAdmin(CacheInvalidatingAdmin, ModelView, model=DrugGroupMap):
    """
    Junction table gán thuốc vào nhóm phê duyệt.
    Nhập drug_id (DrugBank ID, e.g. DB00001) và group_id (từ bảng Drug Groups).
    Hệ thống sẽ tự tra tên nhóm qua group_id.
    """
    name = "Drug Group Map"
    name_plural = "Drug Group Maps"
    icon = "fa-solid fa-sitemap"

    can_create = True
    can_edit   = False   # junction table — PK là (drug_id, group_id)
    can_delete = True

    column_list = [
        DrugGroupMap.drug_id,
        DrugGroupMap.group_id,
        "group",
    ]
    column_searchable_list = [DrugGroupMap.drug_id]
    column_sortable_list   = [DrugGroupMap.drug_id, DrugGroupMap.group_id]
    form_columns = [DrugGroupMap.drug_id, DrugGroupMap.group_id]
    page_size = 50

    column_labels = {
        DrugGroupMap.drug_id:  "DrugBank ID (e.g. DB00001)",
        DrugGroupMap.group_id: "Group ID (tra trong Drug Groups)",
        "group":               "Tên nhóm",
    }

    column_formatters = {
        "group": lambda m, a: Markup(
            f'<span style="padding:2px 8px;border-radius:12px;font-size:0.8em;font-weight:600;background:#eff6ff;color:#1e40af">'
            + (m.group.name if m.group else "—")
            + '</span>'
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Drug Categories  (bảng `categories` — ~5,000 nhóm bệnh MeSH)
# ─────────────────────────────────────────────────────────────────────────────

class DrugCategoryAdmin(CacheInvalidatingAdmin, ModelView, model=DrugCategory):
    """
    Quản lý bảng `categories`.
    Mỗi category là một nhóm bệnh lý / dược lý theo chuẩn MeSH.
    ID của category được dùng trong drug_category_map để gán thuốc vào nhóm bệnh.
    """
    name = "Drug Category"
    name_plural = "Drug Categories"
    icon = "fa-solid fa-tags"

    can_create = True
    can_edit   = True
    can_delete = False

    column_list = [DrugCategory.id, DrugCategory.category, DrugCategory.mesh_id]
    column_searchable_list = [DrugCategory.category, DrugCategory.mesh_id]
    column_sortable_list   = [DrugCategory.id, DrugCategory.category]
    form_columns = [DrugCategory.category, DrugCategory.mesh_id]
    page_size = 50

    column_labels = {
        DrugCategory.id:       "ID (dùng trong drug_category_map)",
        DrugCategory.category: "Tên danh mục bệnh",
        DrugCategory.mesh_id:  "MeSH ID",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Drug Category Map  (bảng `drug_category_map` — junction N-N: drugs ↔ categories)
# ─────────────────────────────────────────────────────────────────────────────

class DrugCategoryMapAdmin(CacheInvalidatingAdmin, ModelView, model=DrugCategoryMap):
    """
    Junction table gán thuốc vào danh mục bệnh.
    Nhập drug_id và category_id (từ bảng Drug Categories).
    """
    name = "Drug Category Map"
    name_plural = "Drug Category Maps"
    icon = "fa-solid fa-diagram-project"

    can_create = True
    can_edit   = False
    can_delete = True

    column_list = [
        DrugCategoryMap.drug_id,
        DrugCategoryMap.category_id,
        "category",
    ]
    column_searchable_list = [DrugCategoryMap.drug_id]
    column_sortable_list   = [DrugCategoryMap.drug_id, DrugCategoryMap.category_id]
    form_columns = [DrugCategoryMap.drug_id, DrugCategoryMap.category_id]
    page_size = 50

    column_labels = {
        DrugCategoryMap.drug_id:     "DrugBank ID (e.g. DB00001)",
        DrugCategoryMap.category_id: "Category ID (tra trong Drug Categories)",
        "category":                  "Tên danh mục",
    }

    column_formatters = {
        "category": lambda m, a: Markup(
            '<span style="font-size:0.82em;color:#1e293b">'
            + (m.category.category[:60] if m.category else "—")
            + '</span>'
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Drug Protein Interactions  (bảng `drug_protein_interactions`)
# ─────────────────────────────────────────────────────────────────────────────

class DrugProteinInteractionAdmin(CacheInvalidatingAdmin, ModelView, model=DrugProteinInteraction):
    """
    Quản lý bảng `drug_protein_interactions` — liên kết thuốc ↔ protein.
    Loại tương tác: target | enzyme | transporter | carrier.
    """
    name = "Drug-Protein Interaction"
    name_plural = "Drug-Protein Interactions"
    icon = "fa-solid fa-dna"

    can_create = True
    can_edit   = True
    can_delete = True
    can_export = True
    export_types = ["csv"]
    export_max_rows = 0

    column_list = [
        DrugProteinInteraction.id,
        DrugProteinInteraction.drug_id,
        DrugProteinInteraction.protein_id,
        DrugProteinInteraction.uniprot_id,
        DrugProteinInteraction.interaction_type,
        DrugProteinInteraction.known_action,
    ]
    column_searchable_list = [
        DrugProteinInteraction.drug_id,
        DrugProteinInteraction.uniprot_id,
        DrugProteinInteraction.interaction_type,
    ]
    column_sortable_list = [
        DrugProteinInteraction.id,
        DrugProteinInteraction.drug_id,
        DrugProteinInteraction.interaction_type,
    ]
    form_columns = [
        DrugProteinInteraction.drug_id,
        DrugProteinInteraction.protein_id,
        DrugProteinInteraction.uniprot_id,
        DrugProteinInteraction.interaction_type,
        DrugProteinInteraction.known_action,
        DrugProteinInteraction.actions,
    ]
    page_size = 50
    page_size_options = [25, 50, 100]

    column_labels = {
        DrugProteinInteraction.drug_id:          "DrugBank ID",
        DrugProteinInteraction.protein_id:       "Protein ID (so nguyen)",
        DrugProteinInteraction.uniprot_id:       "UniProt ID",
        DrugProteinInteraction.interaction_type: "Loai tuong tac",
        DrugProteinInteraction.known_action:     "Known Action",
        DrugProteinInteraction.actions:          "Actions (JSON array)",
    }

    column_formatters = {
        DrugProteinInteraction.interaction_type: lambda m, a: Markup(
            f'<span style="padding:2px 8px;border-radius:10px;font-size:0.78em;font-weight:600;'
            + ("background:#dbeafe;color:#1e40af" if m.interaction_type == "target"
               else "background:#dcfce7;color:#166534" if m.interaction_type == "enzyme"
               else "background:#ede9fe;color:#5b21b6" if m.interaction_type == "transporter"
               else "background:#fef3c7;color:#92400e" if m.interaction_type == "carrier"
               else "background:#f3f4f6;color:#374151")
            + f'">{m.interaction_type or "—"}</span>'
        ),
        DrugProteinInteraction.known_action: lambda m, a: Markup(
            f'<span style="font-size:0.82em;color:#{"166534" if m.known_action=="yes" else "991b1b" if m.known_action=="no" else "64748b"}">'
            + (m.known_action or "unknown")
            + '</span>'
        ),
    }
