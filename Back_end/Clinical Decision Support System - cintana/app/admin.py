"""
sqladmin Admin views.

Provides a modern admin UI at /admin/ backed by SQLAlchemy + MySQL.
"""

from sqladmin import ModelView

from app.models import Drug


class DrugAdmin(ModelView, model=Drug):
    # ── Display ───────────────────────────────────────────────────────────────
    name = "Drug"
    name_plural = "Drugs"
    icon = "fa-solid fa-capsules"

    # Columns shown in list view
    column_list = [
        Drug.drugbank_id,
        Drug.name,
        Drug.drug_type,
        Drug.state,
        Drug.cas_number,
    ]

    # Columns excluded from create/edit forms (read-only data integrity)
    form_excluded_columns = [
        Drug.created_at,
        Drug.updated_at,
    ]

    # ── Search & Filter ───────────────────────────────────────────────────────
    column_searchable_list = [Drug.name, Drug.drugbank_id, Drug.cas_number]
    column_filters = []
    column_sortable_list = [Drug.drugbank_id, Drug.name, Drug.drug_type]

    # Pagination
    page_size = 20
    page_size_options = [10, 20, 50, 100]

    # ── Detail view ───────────────────────────────────────────────────────────
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
