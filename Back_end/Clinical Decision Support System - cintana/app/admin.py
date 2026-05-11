"""
sqladmin Admin views + Authentication.

Provides a protected admin UI at /admin/ backed by SQLAlchemy + MySQL.
Login credentials are read from .env: ADMIN_USERNAME / ADMIN_PASSWORD
"""

from sqladmin import ModelView
from sqladmin.authentication import AuthenticationBackend
from starlette.requests import Request
from markupsafe import Markup

from app.models import (
    Drug, DrugInteraction, Protein, User, AnalysisSession,
    DrugSynonym, DrugProduct, DrugExternalIdentifier, DrugCalculatedProperty,
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
        # Timestamps
        Drug.created_at,
        Drug.updated_at,
    ]

    # ── Form (create/edit) ────────────────────────────────────────────────────
    form_excluded_columns = [
        Drug.created_at,
        Drug.updated_at,
        Drug.synonyms_rel,
        Drug.products_rel,
        Drug.external_ids_rel,
        Drug.calc_props_rel,
        Drug.group_maps,
        Drug.category_maps,
        Drug.drug_interactions_rel,
        Drug.drug_protein_interactions_rel,
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
                f'onerror="this.style.display=\'none\'" />'
                if m.smiles else ""
            )
        ) if True else lambda m, a: m.smiles,
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
        DrugInteraction.interacting_drug_id,
        DrugInteraction.interacting_drug_name,
        DrugInteraction.severity,
        DrugInteraction.description,
        DrugInteraction.created_at,
        DrugInteraction.updated_at,
    ]

    form_excluded_columns = [DrugInteraction.created_at, DrugInteraction.updated_at]

    page_size = 50
    page_size_options = [20, 50, 100, 200]

    column_labels = {
        DrugInteraction.drug_id: "Drug ID",
        DrugInteraction.interacting_drug_id: "Interacting Drug ID",
        DrugInteraction.interacting_drug_name: "Interacting Drug Name",
    }

    column_formatters = {
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
        DrugInteraction.description: lambda m, a: Markup(
            f'<div style="max-height:200px;overflow-y:auto;font-size:0.9em;line-height:1.6">{m.description}</div>'
        ) if m.description else "—",
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

    form_excluded_columns = [Protein.created_at, Protein.updated_at, Protein.drug_protein_interactions]

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

    column_list = [
        User.id,
        User.username,
        User.email,
        User.full_name,
        User.is_active,
        User.is_admin,
        User.avatar_color,
        User.created_at,
    ]

    column_details_list = [
        User.id,
        User.username,
        User.email,
        User.full_name,
        User.is_active,
        User.is_admin,
        User.avatar_color,
        User.created_at,
        User.updated_at,
    ]

    column_searchable_list = [User.username, User.email, User.full_name]
    column_sortable_list = [User.id, User.username, User.created_at, User.is_active]

    form_excluded_columns = [User.hashed_password, User.created_at, User.updated_at]
    column_details_exclude_list = [User.hashed_password]

    page_size = 50

    column_formatters = {
        User.is_active: lambda m, a: Markup(
            '<span style="padding:2px 8px;border-radius:12px;font-size:0.82em;font-weight:600;background:#dcfce7;color:#166534">Active</span>'
            if m.is_active else
            '<span style="padding:2px 8px;border-radius:12px;font-size:0.82em;font-weight:600;background:#fee2e2;color:#991b1b">Inactive</span>'
        ),
        User.avatar_color: lambda m, a: Markup(
            f'<span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:{m.avatar_color};vertical-align:middle"></span> {m.avatar_color}'
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
    form_excluded_columns = []
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
    form_excluded_columns = []
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
    form_excluded_columns = []
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
    form_excluded_columns = []
    page_size = 50
    page_size_options = [20, 50, 100]

    column_labels = {
        DrugCalculatedProperty.kind: "Property",
        DrugCalculatedProperty.value: "Value",
        DrugCalculatedProperty.source: "Source (Calculator)",
    }
