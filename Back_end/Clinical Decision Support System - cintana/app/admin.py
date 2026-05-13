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
    drug_id             = StringField("Drug A \u2014 DrugBank ID (VD: DB00001)", validators=[DataRequired()])
    drug_name           = StringField("Drug A \u2014 T\u00ean thu\u1ed1c",          validators=[WTOptional()])
    interacting_drug_id = StringField("Drug B \u2014 DrugBank ID (VD: DB00006)", validators=[DataRequired()])
    interacting_drug_name = StringField("Drug B \u2014 T\u00ean thu\u1ed1c",        validators=[WTOptional()])
    severity            = StringField("M\u1ee9c \u0111\u1ed9 (major / moderate / minor)", validators=[WTOptional()])
    description         = TextAreaField("M\u00f4 t\u1ea3 t\u01b0\u01a1ng t\u00e1c",       validators=[WTOptional()])

from app.models import (
    Drug, DrugInteraction, Protein, User, AnalysisSession,
    DrugSynonym, DrugProduct, DrugExternalIdentifier, DrugCalculatedProperty,
    DrugFoodInteraction, DrugDosage,
)
from app.config import get_settings


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


# ── Model Views ───────────────────────────────────────────────────────────────

class DrugAdmin(ModelView, model=Drug):
    name = "Drug"
    name_plural = "Drugs"
    icon = "fa-solid fa-capsules"

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

    # ── Detail view — tất cả fields ───────────────────────────────────────────
    column_details_list = [
        Drug.drugbank_id,
        Drug.name,
        Drug.drug_type,
        Drug.cas_number,
        Drug.unii,
        Drug.atc_codes,
        Drug.state,
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
        # Brand names
        Drug.products_rel,
        # Timestamps
        Drug.created_at,
        Drug.updated_at,
    ]

    # ── Inline sub-forms (shown inside Drug create/edit page) ────────────────
    inline_models = [
        (DrugSynonym, {"form_columns": ["synonym", "language", "coder"],
                        "label": "Tên đồng nghĩa (Synonyms)"}),
        (DrugProduct, {"form_columns": ["name", "labeller", "ndc_id", "dosage_form",
                                        "strength", "route", "country", "source"],
                        "label": "Sản phẩm thương mại (Products)"}),
        (DrugFoodInteraction, {"form_columns": ["interaction"],
                               "label": "Tương tác thức ăn (Food Interactions)"}),
        (DrugDosage, {"form_columns": ["form", "route", "strength"],
                      "label": "Liều dùng (Dosages)"}),
        (DrugInteraction, {"form_columns": ["interacting_drug_id", "interacting_drug_name",
                                            "severity", "description"],
                           "label": "Tương tác thuốc (Drug Interactions)"}),
    ]

    # ── Form (create/edit) — only scalar columns, exclude timestamps + relationships ──
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
    }

    # ── Formatter: hiển thị cấu trúc hóa học từ PubChem qua SMILES/InChIKey ──
    column_formatters_detail = {
        Drug.smiles: lambda m, a: Markup(
            f'<code style="word-break:break-all;font-size:0.8em">{m.smiles}</code>'
            + (
                f'<br><img src="https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/{m.smiles}/PNG?image_size=300x200" '
                f'style="margin-top:8px;border:1px solid #e2e8f0;border-radius:6px" '
                f'onerror="this.style.display:none" />'
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
        # Brand names / products
        "products_rel": lambda m, a: (
            Markup(
                '<table style="width:100%;border-collapse:collapse;font-size:0.82em">'
                '<thead><tr>'
                '<th style="text-align:left;padding:4px 8px;background:#f1f5f9;color:#475569;font-weight:700">Brand Name</th>'
                '<th style="text-align:left;padding:4px 8px;background:#f1f5f9;color:#475569;font-weight:700">Manufacturer</th>'
                '<th style="text-align:left;padding:4px 8px;background:#f1f5f9;color:#475569;font-weight:700">Form</th>'
                '<th style="text-align:left;padding:4px 8px;background:#f1f5f9;color:#475569;font-weight:700">Country</th>'
                '</tr></thead><tbody>'
                + ''.join(
                    f'<tr style="border-bottom:1px solid #e2e8f0">'
                    f'<td style="padding:4px 8px;font-weight:600;color:#1e293b">{p.name or "—"}</td>'
                    f'<td style="padding:4px 8px;color:#64748b">{p.labeller or "—"}</td>'
                    f'<td style="padding:4px 8px;color:#64748b">{p.dosage_form or "—"}</td>'
                    f'<td style="padding:4px 8px;color:#64748b">{p.country or "—"}</td>'
                    f'</tr>'
                    for p in m.products_rel[:20]
                )
                + ('</tbody></table>'
                   + (f'<div style="font-size:0.78em;color:#94a3b8;margin-top:4px">Showing 20 of {len(m.products_rel)}</div>' if len(m.products_rel) > 20 else '</tbody></table>'))
            ) if m.products_rel else Markup('<em style="color:#94a3b8">No brand names in database</em>')
        ),
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


class DrugInteractionAdmin(ModelView, model=DrugInteraction):
    name = "Drug Interaction"
    name_plural = "Drug Interactions"
    icon = "fa-solid fa-triangle-exclamation"

    can_create = True
    can_edit = True
    can_delete = True

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
        DrugInteraction.drug_id:              "Drug A — DrugBank ID (VD: DB00001)",
        "drug_name":                          "Drug A — Tên thuốc",
        DrugInteraction.interacting_drug_id:  "Drug B — DrugBank ID (VD: DB00006)",
        DrugInteraction.interacting_drug_name: "Drug B — Tên thuốc",
        DrugInteraction.severity:             "Mức độ (major / moderate / minor)",
        DrugInteraction.description:          "Mô tả tương tác",
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


class ProteinAdmin(ModelView, model=Protein):
    name = "Protein"
    name_plural = "Proteins"
    icon = "fa-solid fa-dna"

    can_create = True
    can_edit = True
    can_delete = False

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


class UserAdmin(ModelView, model=User):
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


class AnalysisSessionAdmin(ModelView, model=AnalysisSession):
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

class DrugSynonymAdmin(ModelView, model=DrugSynonym):
    name = "Drug Synonym"
    name_plural = "Drug Synonyms"
    icon = "fa-solid fa-tag"

    can_create = True
    can_edit = True
    can_delete = True

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


class DrugProductAdmin(ModelView, model=DrugProduct):
    name = "Drug Product"
    name_plural = "Drug Products"
    icon = "fa-solid fa-box"

    can_create = True
    can_edit = True
    can_delete = True

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


class DrugExternalIdentifierAdmin(ModelView, model=DrugExternalIdentifier):
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


class DrugCalculatedPropertyAdmin(ModelView, model=DrugCalculatedProperty):
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


class DrugFoodInteractionAdmin(ModelView, model=DrugFoodInteraction):
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


class DrugDosageAdmin(ModelView, model=DrugDosage):
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
