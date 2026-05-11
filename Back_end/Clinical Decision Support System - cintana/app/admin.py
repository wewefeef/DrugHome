"""
sqladmin Admin views + Authentication.

Provides a protected admin UI at /admin/ backed by SQLAlchemy + MySQL.
Login credentials are read from .env: ADMIN_USERNAME / ADMIN_PASSWORD
"""

from sqladmin import ModelView
from sqladmin.authentication import AuthenticationBackend
from starlette.requests import Request
from starlette.responses import RedirectResponse

from app.models import Drug, DrugInteraction, Protein, User, AnalysisSession
from app.config import get_settings


# ── Authentication ────────────────────────────────────────────────────────────

class AdminAuth(AuthenticationBackend):
    """Simple session-based auth for the sqladmin panel.

    Credentials are stored in .env:
        ADMIN_USERNAME=admin
        ADMIN_PASSWORD=your-strong-password
    """

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

    column_list = [
        Drug.drugbank_id,
        Drug.name,
        Drug.drug_type,
        Drug.state,
        Drug.cas_number,
        Drug.atc_codes,
    ]

    form_excluded_columns = [Drug.created_at, Drug.updated_at]

    column_searchable_list = [Drug.name, Drug.drugbank_id, Drug.cas_number]
    column_sortable_list = [Drug.drugbank_id, Drug.name, Drug.drug_type, Drug.state]

    page_size = 20
    page_size_options = [10, 20, 50, 100]

    column_details_list = [
        Drug.drugbank_id,
        Drug.name,
        Drug.drug_type,
        Drug.cas_number,
        Drug.unii,
        Drug.state,
        Drug.description,
        Drug.indication,
        Drug.mechanism_of_action,
        Drug.pharmacodynamics,
        Drug.toxicity,
        Drug.absorption,
        Drug.metabolism,
        Drug.half_life,
        Drug.route_of_elimination,
        Drug.protein_binding,
        Drug.atc_codes,
        Drug.inchikey,
    ]


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

    column_sortable_list = [
        DrugInteraction.drug_id,
        DrugInteraction.severity,
    ]

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
    ]

    column_searchable_list = [Protein.name, Protein.gene_name, Protein.uniprot_id]
    column_sortable_list = [Protein.id, Protein.name, Protein.gene_name, Protein.protein_type]

    form_excluded_columns = [Protein.created_at, Protein.updated_at]

    page_size = 50
    page_size_options = [20, 50, 100]


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
        User.created_at,
    ]

    column_searchable_list = [User.username, User.email, User.full_name]
    column_sortable_list = [User.id, User.username, User.created_at]

    # Never expose password hash in forms or detail
    form_excluded_columns = [User.hashed_password, User.created_at, User.updated_at]
    column_details_exclude_list = [User.hashed_password]

    page_size = 50


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
        AnalysisSession.total_interactions,
        AnalysisSession.created_at,
    ]

    column_searchable_list = [AnalysisSession.title, AnalysisSession.risk_level]
    column_sortable_list = [AnalysisSession.id, AnalysisSession.risk_score, AnalysisSession.created_at]

    page_size = 50
    page_size_options = [20, 50, 100]
