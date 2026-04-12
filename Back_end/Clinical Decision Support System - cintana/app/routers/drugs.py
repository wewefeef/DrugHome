"""
All HTTP endpoints — replaces drugs/views.py + drugs/urls.py.

Routes:
  GET  /                         → redirect to /network-map/
  GET  /about/                   → about page
  GET  /drugs/                   → drug index (search + filter)
  GET  /drugs/{drugbank_id}/     → monograph detail
  GET  /network-map/             → drug interaction network map
  GET  /api/drug-autocomplete/   → autocomplete JSON API
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi_cache.decorator import cache
from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import or_, func, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import Drug

settings = get_settings()

router = APIRouter()

# ── Jinja2 template environment ──────────────────────────────────────────────

_jinja_env = Environment(
    loader=FileSystemLoader(str(settings.templates_dir)),
    autoescape=select_autoescape(["html"]),
)


def _add_template_filters():
    """Register custom filters — mirrors drugs/templatetags/drug_filters.py."""

    def get_item(mapping, key):
        try:
            return (mapping or {}).get(key)
        except Exception:
            return None

    def escapejs(value):
        """Escape a string for safe use inside a JavaScript string literal."""
        if value is None:
            return ""
        value = str(value)
        value = value.replace("\\", "\\\\")
        value = value.replace("'", "\\'")
        value = value.replace('"', '\\"')
        value = value.replace("\r\n", "\\n")
        value = value.replace("\r", "\\n")
        value = value.replace("\n", "\\n")
        value = value.replace("\t", "\\t")
        value = value.replace("\x00", "")
        return value

    def format_drug_text(text_val):
        if not text_val:
            return ""
        text_val = str(text_val)
        text_val = text_val.replace("&lt;sub&gt;", "<sub>").replace("&lt;/sub&gt;", "</sub>")
        text_val = text_val.replace("&lt;sup&gt;", "<sup>").replace("&lt;/sup&gt;", "</sup>")
        text_val = re.sub(r"\*\*(.*?)\*\*", r'<strong class="text-gray-900 font-bold">\1</strong>', text_val)
        text_val = re.sub(r"_(.*?)_", r'<em class="text-gray-700 italic">\1</em>', text_val)
        text_val = re.sub(
            r"\[((?:A|F|L)\d+|FDA label)\]",
            r'<sup class="text-xs text-gray-400 bg-gray-100 px-1 rounded ml-0.5 cursor-help" title="Reference: \1">\1</sup>',
            text_val,
        )
        text_val = re.sub(
            r"\[(.*?)\]",
            r'<a href="/?q=\1" class="text-blue-600 hover:text-blue-800 hover:underline font-medium">\1</a>',
            text_val,
        )
        text_val = text_val.replace(" •", "<br>•")
        text_val = re.sub(r"\n\n+", "</p><p class=\"mt-2\">", text_val)
        text_val = re.sub(r"\n", "<br>", text_val)
        return text_val

    _jinja_env.filters["get_item"] = get_item
    _jinja_env.filters["escapejs"] = escapejs
    _jinja_env.filters["format_drug_text"] = format_drug_text
    _jinja_env.filters["urlencode"] = lambda v: quote_plus(str(v or ""))
    _jinja_env.globals["tojson"] = lambda v, **kw: json.dumps(v, **kw)
    _jinja_env.globals["min"] = min


_add_template_filters()


def _render(template_name: str, context: dict) -> HTMLResponse:
    tmpl = _jinja_env.get_template(template_name)
    html = tmpl.render(**context)
    return HTMLResponse(content=html)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _parse_bool(value: Optional[str], default: bool = True) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "on", "yes"}


def _safe_int(value: Optional[str], default: int, min_v: int, max_v: int) -> int:
    cleaned = re.sub(r"[^0-9\-]+", "", str(value or ""))
    try:
        parsed = int(cleaned)
    except Exception:
        return default
    return max(min_v, min(max_v, parsed))


def _slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_\-]+", "_", (value or "").strip())
    return cleaned[:80] if cleaned else "unknown"


def _stable_cache_key(prefix: str, suffix: str = "") -> str:
    digest = hashlib.md5(f"{prefix}|{suffix}".encode()).hexdigest()
    return f"{prefix}:{digest}:v1"


def _target_key(t: dict) -> str:
    if not isinstance(t, dict):
        return ""
    uniprot = (t.get("uniprot_id") or "").strip()
    if uniprot:
        return f"uniprot:{uniprot.upper()}"
    gene = (t.get("gene_name") or t.get("gene") or "").strip()
    if gene:
        return f"gene:{gene.upper()}"
    name = (t.get("name") or "").strip()
    if name:
        return f"name:{name.lower()}"
    return ""


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/", include_in_schema=False)
def home():
    return RedirectResponse(url="/network-map/", status_code=302)


@router.get("/about/", response_class=HTMLResponse)
def about():
    return _render("drugs/about.html", {})


# ── Autocomplete API ─────────────────────────────────────────────────────────

@router.get("/api/drug-autocomplete/", response_class=JSONResponse)
def drug_autocomplete(
    q: str = Query(default="", min_length=0),
    db: Session = Depends(get_db),
):
    query = q.strip()
    if len(query) < 2:
        return JSONResponse({"results": []})

    id_match = re.search(r"(DB\d{4,})", query, re.IGNORECASE)
    normalized_id = id_match.group(1).upper() if id_match else ""

    filters = [
        Drug.name.ilike(f"%{query}%"),
        Drug.drugbank_id.ilike(f"%{query}%"),
    ]
    if normalized_id:
        filters.append(Drug.drugbank_id == normalized_id)

    rows = (
        db.query(Drug.drugbank_id, Drug.name, Drug.drug_type)
        .filter(or_(*filters))
        .order_by(Drug.name)
        .limit(30)
        .all()
    )
    results = [{"drugbank_id": r.drugbank_id, "name": r.name, "drug_type": r.drug_type} for r in rows]
    return JSONResponse({"results": results})


# ── Drug Index ───────────────────────────────────────────────────────────────

@router.get("/drugs/", response_class=HTMLResponse)
def drug_index(
    request: Request,
    q: str = Query(default=""),
    type: str = Query(default=""),
    has_genomics: str = Query(default=""),
    has_toxicity: str = Query(default=""),
    has_interactions: str = Query(default=""),
    has_targets: str = Query(default=""),
    per_page: int = Query(default=50),
    page: int = Query(default=1),
    db: Session = Depends(get_db),
):
    query = q.strip()
    drug_type = type.strip()
    per_page_options = [10, 50, 100, 250, 500]
    if per_page not in per_page_options:
        per_page = 50

    qs = db.query(Drug)

    if query:
        id_match = re.search(r"(DB\d{4,})", query, re.IGNORECASE)
        extracted_id = id_match.group(1).upper() if id_match else ""
        extracted_name = re.sub(r"\(\s*DB\d{4,}\s*\)", "", query, re.IGNORECASE).strip()

        filters = [
            Drug.name.ilike(f"%{query}%"),
            Drug.drugbank_id.ilike(f"%{query}%"),
            Drug.cas_number.ilike(f"%{query}%"),
        ]
        if extracted_id:
            filters.append(Drug.drugbank_id == extracted_id)
        if extracted_name and extracted_name != query:
            filters.append(Drug.name.ilike(f"%{extracted_name}%"))
        qs = qs.filter(or_(*filters))

    if drug_type:
        qs = qs.filter(Drug.drug_type == drug_type)

    # Note: genomics/interactions/targets are not stored as columns in MySQL
    # Those filters are no-ops but we keep the params to avoid 422 errors

    if has_toxicity == "1":
        qs = qs.filter(Drug.toxicity.isnot(None), Drug.toxicity != "")
    elif has_toxicity == "0":
        qs = qs.filter(or_(Drug.toxicity.is_(None), Drug.toxicity == ""))

    qs = qs.order_by(Drug.name)

    total_count = qs.count()
    offset = (page - 1) * per_page
    drugs = qs.offset(offset).limit(per_page).all()

    total_pages = (total_count + per_page - 1) // per_page

    return _render("drugs/index.html", {
        "request": request,
        "query": query,
        "drug_type": drug_type,
        "has_genomics": has_genomics,
        "has_toxicity": has_toxicity,
        "has_interactions": has_interactions,
        "has_targets": has_targets,
        "per_page": per_page,
        "per_page_options": per_page_options,
        "drug_type_choices": ["small molecule", "biotech"],
        "drugs": drugs,
        "total_count": total_count,
        "page": page,
        "total_pages": total_pages,
        "has_prev": page > 1,
        "has_next": page < total_pages,
    })


# ── Monograph Detail ─────────────────────────────────────────────────────────

@router.get("/drugs/{drugbank_id}/", response_class=HTMLResponse)
def drug_monograph_detail(
    request: Request,
    drugbank_id: str,
    return_to: str = Query(default=""),
    db: Session = Depends(get_db),
):
    drug = db.query(Drug).filter(Drug.drugbank_id == drugbank_id).first()
    if not drug:
        return HTMLResponse("Drug not found", status_code=404)

    interactions = drug.interactions or []
    food_interactions = drug.food_interactions or []
    targets = drug.targets or []
    enzymes = drug.enzymes or []
    transporters = drug.transporters or []
    carriers = drug.carriers or []
    genomics = drug.genomics or []
    products = drug.products or []
    international_brands = drug.international_brands or []
    sequences = drug.sequences or []
    external_identifiers = drug.external_identifiers or []
    external_links = drug.external_links or []
    groups = drug.groups or []
    synonyms = drug.synonyms or []
    categories = drug.categories or []

    def normalize_categories(values):
        result = []
        for v in values or []:
            if isinstance(v, dict):
                name = (v.get("category") or v.get("name") or v.get("value") or "").strip()
                mesh_id = (v.get("mesh_id") or v.get("mesh") or "").strip()
            else:
                name = str(v or "").strip()
                mesh_id = ""
            if name:
                result.append({"name": name, "mesh_id": mesh_id})
        return result

    def normalize_external_identifiers(values):
        result = []
        for v in values or []:
            if isinstance(v, dict):
                resource = (v.get("resource") or v.get("source") or v.get("name") or "").strip()
                identifier = str(v.get("identifier") or v.get("id") or v.get("value") or "").strip()
            else:
                resource, identifier = "Identifier", str(v or "").strip()
            if resource or identifier:
                result.append({"resource": resource or "Identifier", "identifier": identifier or "-"})
        return result

    def normalize_external_links(values):
        result = []
        for v in values or []:
            if isinstance(v, dict):
                resource = (v.get("resource") or v.get("source") or v.get("name") or "External Link").strip()
                url = str(v.get("url") or v.get("link") or "").strip()
            else:
                resource, url = "External Link", str(v or "").strip()
            if url:
                result.append({"resource": resource, "url": url})
        return result

    def normalize_reference_item(item):
        if isinstance(item, dict):
            pubmed_id = str(item.get("pubmed_id") or "").strip()
            citation = str(item.get("citation") or "").strip()
            title = str(item.get("title") or "").strip()
            resource = str(item.get("resource") or "").strip()
            ref_id = str(item.get("ref_id") or "").strip()
            url = str(item.get("url") or item.get("link") or "").strip()
            if citation:
                prefix = f"PMID {pubmed_id} — " if pubmed_id else ""
                suffix = f" ({ref_id})" if ref_id else ""
                return {"text": f"{prefix}{citation}{suffix}", "url": url}
            if title and url:
                label = f"{resource}: {title}" if resource else title
                return {"text": label, "url": url}
            if resource and url:
                return {"text": resource, "url": url}
            parts = [f"{k.replace('_',' ').title()}: {str(v or '').strip()}" for k, v in item.items() if str(v or "").strip()]
            return {"text": " | ".join(parts), "url": url} if parts else None
        text_val = str(item or "").strip()
        return {"text": text_val, "url": ""} if text_val else None

    def normalize_reference_sections(general_refs):
        sections = []
        if not isinstance(general_refs, dict):
            return sections
        for key, value in general_refs.items():
            raw_items = value if isinstance(value, list) else ([value] if value else [])
            items = [r for r in (normalize_reference_item(i) for i in raw_items) if r]
            sections.append({"key": key, "label": key.replace("_", " ").title(), "items": items, "count": len(items)})
        sections.sort(key=lambda s: s["label"].lower())
        return sections

    def build_monograph_network():
        drug_node_id = f"drug:{drug.drugbank_id}"
        nodes = [{"id": drug_node_id, "label": drug.name, "group": "drug_main",
                  "title": f"{drug.drugbank_id} — {drug.name}", "shape": "dot", "size": 26}]
        edges = []
        node_ids = {drug_node_id}

        def add_node(nid, label, group, title=""):
            if nid not in node_ids:
                node_ids.add(nid)
                nodes.append({"id": nid, "label": label, "group": group, "title": title or label, "shape": "dot"})

        def add_edge(src, dst, label=""):
            edges.append({"from": src, "to": dst, "label": label, "arrows": "to",
                          "font": {"size": 10}, "length": 150})

        for item in (targets or [])[:16]:
            if not isinstance(item, dict):
                continue
            name = (item.get("name") or "").strip() or "Target"
            gene = (item.get("gene_name") or item.get("gene") or "").strip()
            uniprot = (item.get("uniprot_id") or "").strip()
            nid = f"target:{uniprot or gene or name}"
            add_node(nid, name, "target", f"{name} ({gene})" if gene else name)
            add_edge(drug_node_id, nid, "targets")
            if gene:
                gid = f"gene:{gene.upper()}"
                add_node(gid, gene, "gene", f"Gene: {gene}")
                add_edge(nid, gid, "gene")
        for item in (enzymes or [])[:8]:
            name = (item.get("name") or "").strip() if isinstance(item, dict) else ""
            if name:
                add_node(f"enzyme:{name}", name, "enzyme")
                add_edge(drug_node_id, f"enzyme:{name}", "enzyme")
        for item in (transporters or [])[:8]:
            name = (item.get("name") or "").strip() if isinstance(item, dict) else ""
            if name:
                add_node(f"transporter:{name}", name, "transporter")
                add_edge(drug_node_id, f"transporter:{name}", "transporter")
        for item in (carriers or [])[:8]:
            name = (item.get("name") or "").strip() if isinstance(item, dict) else ""
            if name:
                add_node(f"carrier:{name}", name, "carrier")
                add_edge(drug_node_id, f"carrier:{name}", "carrier")
        for item in (interactions or [])[:14]:
            if not isinstance(item, dict):
                continue
            other_id = (item.get("drugbank_id") or "").strip().upper()
            other_name = (item.get("name") or "").strip() or other_id
            if not other_id:
                continue
            nid = f"interactor:{other_id}"
            add_node(nid, other_name, "drug_interact", f"{other_name} ({other_id})")
            add_edge(drug_node_id, nid, "interacts")
        for item in (food_interactions or [])[:6]:
            text_val = str(item or "").strip()
            if text_val:
                compact = re.sub(r"\s+", " ", text_val)
                nid = f"food:{compact[:60].lower()}"
                add_node(nid, compact[:40], "food", compact)
                add_edge(drug_node_id, nid, "food")
        return {"nodes": nodes, "edges": edges}

    data_availability = {
        "description": bool(drug.description),
        "indication": bool(drug.indication),
        "mechanism_of_action": bool(drug.mechanism_of_action),
        "pharmacodynamics": bool(drug.pharmacodynamics),
        "toxicity": bool(drug.toxicity),
        "metabolism": bool(drug.metabolism),
        "absorption": bool(drug.absorption),
        "half_life": bool(drug.half_life),
        "route_of_elimination": bool(drug.route_of_elimination),
        "volume_of_distribution": bool(drug.volume_of_distribution),
        "clearance": bool(drug.clearance),
        "genomics": len(genomics) > 0,
        "targets": len(targets) > 0,
        "enzymes": len(enzymes) > 0,
        "transporters": len(transporters) > 0,
        "carriers": len(carriers) > 0,
        "interactions": len(interactions) > 0,
        "food_interactions": len(food_interactions) > 0,
        "products": len(products) > 0,
        "international_brands": len(international_brands) > 0,
        "sequences": len(sequences) > 0,
        "external_identifiers": len(external_identifiers) > 0,
        "external_links": len(external_links) > 0,
        "references": len(normalize_reference_sections(drug.general_references or {})) > 0,
        "synonyms": len(synonyms) > 0,
        "categories": len(categories) > 0,
    }

    default_map_url = f"/network-map/?drug={drug.drugbank_id}"
    return_to_url = return_to if return_to.startswith("/network-map") else default_map_url

    return _render("drugs/monograph_detail.html", {
        "request": request,
        "drug": drug,
        "targets": targets,
        "enzymes": enzymes,
        "transporters": transporters,
        "carriers": carriers,
        "genomics": genomics,
        "interactions": interactions,
        "food_interactions": food_interactions,
        "products": products,
        "international_brands": international_brands,
        "sequences": sequences,
        "external_identifiers": external_identifiers,
        "external_links": external_links,
        "external_identifiers_display": normalize_external_identifiers(external_identifiers),
        "external_links_display": normalize_external_links(external_links),
        "groups": groups,
        "synonyms": synonyms,
        "categories": categories,
        "categories_display": normalize_categories(categories),
        "smiles": (drug.smiles or "").strip(),
        "monograph_network_json": json.dumps(build_monograph_network()),
        "reference_sections": normalize_reference_sections(drug.general_references or {}),
        "data_availability": data_availability,
        "interaction_total": len(interactions),
        "food_interaction_total": len(food_interactions),
        "return_to_url": return_to_url,
        "default_map_url": default_map_url,
    })


# ── Network Map ───────────────────────────────────────────────────────────────

@router.get("/network-map/", response_class=HTMLResponse)
def drug_network_map(
    request: Request,
    drug: List[str] = Query(default=[]),
    drugs: List[str] = Query(default=[]),
    show_targets: str = Query(default="1"),
    show_genes: str = Query(default="0"),
    show_food: str = Query(default="1"),
    show_drug_interactions: str = Query(default="0"),
    show_enzymes: str = Query(default="0"),
    show_transporters: str = Query(default="0"),
    show_carriers: str = Query(default="0"),
    include_neighbor_drugs: str = Query(default="0"),
    max_nodes: str = Query(default="80"),
    db: Session = Depends(get_db),
):
    # ── Parse filters ────────────────────────────────────────────────────────
    f_targets = _parse_bool(show_targets, True)
    f_genes = _parse_bool(show_genes, False)
    f_food = _parse_bool(show_food, True)
    f_drug_interactions = _parse_bool(show_drug_interactions, False)
    f_enzymes = _parse_bool(show_enzymes, False)
    f_transporters = _parse_bool(show_transporters, False)
    f_carriers = _parse_bool(show_carriers, False)
    f_neighbor_drugs = _parse_bool(include_neighbor_drugs, False)
    max_nodes_int = _safe_int(max_nodes, 80, 20, 250)

    # ── Resolve drug tokens ───────────────────────────────────────────────────
    raw_inputs = list(drug) + list(drugs)
    tokens: list[str] = []
    for item in raw_inputs:
        for part in str(item).replace(";", ",").split(","):
            token = part.strip()
            if token:
                m = re.search(r"(DB\d{4,})", token, re.IGNORECASE)
                tokens.append(m.group(1).upper() if m else token)

    seen: set[str] = set()
    selected_inputs: list[str] = []
    for tok in tokens:
        key = tok.strip().lower()
        if key not in seen:
            seen.add(key)
            selected_inputs.append(tok.strip())
        if len(selected_inputs) >= 6:
            break

    # ── DB lookup ────────────────────────────────────────────────────────────
    selected_drugs_list: list[Drug] = []
    selected_display_inputs: list[str] = []
    selected_ids: set[str] = set()

    if selected_inputs:
        id_like = [t.upper() for t in selected_inputs if re.match(r"^DB\d{4,}$", t.strip(), re.IGNORECASE)]
        name_like = [t for t in selected_inputs if not re.match(r"^DB\d{4,}$", t.strip(), re.IGNORECASE)]

        filters = []
        if id_like:
            filters.append(Drug.drugbank_id.in_(id_like))
        for nm in name_like:
            filters.append(Drug.name.ilike(nm))

        candidates = db.query(Drug).filter(or_(*filters)).all() if filters else []
        by_id = {d.drugbank_id.upper(): d for d in candidates}
        by_name = {(d.name or "").strip().lower(): d for d in candidates}

        for tok in selected_inputs:
            if len(selected_drugs_list) >= 6:
                break
            t = tok.strip()
            cand = by_id.get(t.upper()) or by_name.get(t.lower())
            if cand is None:
                cand = (
                    db.query(Drug)
                    .filter(or_(Drug.drugbank_id.ilike(f"%{t}%"), Drug.name.ilike(f"%{t}%")))
                    .first()
                )
            if cand:
                selected_display_inputs.append(f"{cand.name} ({cand.drugbank_id})")
            else:
                selected_display_inputs.append(t)
            if cand and cand.drugbank_id not in selected_ids:
                selected_drugs_list.append(cand)
                selected_ids.add(cand.drugbank_id)

    first_drug = selected_drugs_list[0] if selected_drugs_list else None

    # ── Build comparative targets matrix ─────────────────────────────────────
    def build_comparative_targets(drugs_list: list[Drug]) -> dict:
        index: dict[str, Any] = {}
        counts: dict[str, int] = {}
        for d in drugs_list or []:
            seen_keys: set[str] = set()
            for t in (d.targets or []):
                if not isinstance(t, dict):
                    continue
                key = _target_key(t)
                if not key or key in seen_keys:
                    continue
                seen_keys.add(key)
                if key not in index:
                    index[key] = {
                        "key": key,
                        "name": (t.get("name") or "").strip() or "Unknown protein",
                        "gene_name": (t.get("gene_name") or t.get("gene") or "").strip(),
                        "uniprot_id": (t.get("uniprot_id") or "").strip(),
                        "per_drug": {},
                    }
                index[key]["per_drug"][d.drugbank_id] = t
                counts[key] = counts.get(key, 0) + 1

        rows = list(index.values())
        sort_name = lambda r: (r.get("gene_name") or r.get("name") or "").lower()
        shared = sorted([r for r in rows if counts.get(r["key"], 0) >= 2],
                        key=lambda r: (-counts.get(r["key"], 0), sort_name(r)))
        unique = sorted([r for r in rows if counts.get(r["key"], 0) < 2], key=sort_name)
        for r in shared + unique:
            r["shared_count"] = counts.get(r["key"], 0)
            r["is_shared"] = r["shared_count"] >= 2
        return {"rows": shared + unique, "shared_count": len(shared), "total_count": len(rows)}

    # ── Build cross-interaction analysis ─────────────────────────────────────
    def build_cross_interactions(drugs_list: list[Drug]) -> list[dict]:
        id_to_name = {d.drugbank_id: d.name for d in drugs_list or []}
        pair_index: dict[str, Any] = {}

        def jaccard(a: set, b: set) -> float:
            union = a | b
            return len(a & b) / len(union) if union else 0.0

        def extract_target_set(d: Drug) -> set:
            return {_target_key(t) for t in (d.targets or []) if isinstance(t, dict) and _target_key(t)}

        def extract_pathway_terms(d: Drug) -> set:
            full_text = " ".join([
                str(getattr(d, "metabolism", "") or "").lower(),
                str(getattr(d, "pharmacodynamics", "") or "").lower(),
                str(getattr(d, "mechanism_of_action", "") or "").lower(),
            ])
            terms: set[str] = set()
            marker_re = r"\b(?:cyp\d+[a-z0-9]*|ugt\d+[a-z0-9]*|abcb\d+|abcc\d+|slc\w+|p[- ]?glycoprotein|nf[- ]?kappa[- ]?b|cox[- ]?[12]|jak\d|stat\d|mapk\d*|pi3k|akt\d?)\b"
            for m in re.findall(marker_re, full_text, re.IGNORECASE):
                terms.add(m.replace("-", "").replace(" ", "").upper())
            pathway_kws = [
                "calcium channel", "sodium channel", "potassium channel", "renin angiotensin",
                "angiotensin", "aldosterone", "adrenergic", "cholinergic", "dopaminergic",
                "serotonergic", "glucocorticoid receptor", "mineralocorticoid receptor",
                "nitric oxide", "cyclooxygenase", "prostaglandin", "inflammation",
                "immunosuppressive", "vasodilation", "platelet aggregation", "hmg coa reductase",
                "p53", "apoptosis", "oxidative stress", "mitochondrial",
            ]
            for phrase in pathway_kws:
                if phrase in full_text:
                    terms.add(phrase.upper().replace(" ", "_"))
            for bucket in (d.targets or [], d.enzymes or [], d.transporters or [], d.carriers or []):
                for item in bucket:
                    if isinstance(item, dict):
                        gene = str(item.get("gene_name") or item.get("gene") or "").strip()
                        if gene:
                            terms.add(gene.upper())
            for g_item in (d.genomics or []):
                if isinstance(g_item, dict):
                    gene = str(g_item.get("gene") or "").strip()
                    if gene:
                        terms.add(gene.upper())
            return terms

        def extract_metabolic_markers(d: Drug) -> set:
            markers: set[str] = set()
            metab_text = str(getattr(d, "metabolism", "") or "")
            for m in re.findall(r"\b(?:CYP\d+[A-Z0-9]*|UGT\d+[A-Z0-9]*|ABCB\d+|ABCC\d+|SLC\w+)\b", metab_text, re.IGNORECASE):
                markers.add(m.upper())
            for bucket in (d.enzymes or [], d.transporters or [], d.carriers or []):
                for item in bucket:
                    if isinstance(item, dict):
                        gene = str(item.get("gene_name") or item.get("gene") or "").strip().upper()
                        if gene:
                            markers.add(gene)
            return markers

        def infer_severity(desc: str) -> tuple[str, int]:
            text_val = (desc or "").lower()
            if re.search(r"contraindicat|avoid|fatal|life[- ]?threat|severe|major", text_val):
                return ("High", 3)
            if re.search(r"moderate|monitor|caution|dose adjustment|increase|decrease", text_val):
                return ("Moderate", 2)
            return ("Low", 1)

        profile_by_id = {
            d.drugbank_id: {
                "targets": extract_target_set(d),
                "pathways": extract_pathway_terms(d),
                "metabolic_markers": extract_metabolic_markers(d),
            }
            for d in drugs_list or []
        }

        for src in drugs_list or []:
            for inter in (src.interactions or []):
                if not isinstance(inter, dict):
                    continue
                other_id = (inter.get("drugbank_id") or "").strip().upper()
                if not other_id or other_id == src.drugbank_id or other_id not in id_to_name:
                    continue
                a_id, b_id = sorted([src.drugbank_id, other_id])
                key = f"{a_id}|{b_id}"
                if key not in pair_index:
                    pair_index[key] = {
                        "drug_a_id": a_id, "drug_a_name": id_to_name.get(a_id, a_id),
                        "drug_b_id": b_id, "drug_b_name": id_to_name.get(b_id, b_id),
                        "evidence_count": 0, "descriptions": [], "severity": "Low",
                        "severity_score": 1, "_desc_seen": set(), "_source_ids": set(),
                    }
                row = pair_index[key]
                row["evidence_count"] += 1
                row["_source_ids"].add(src.drugbank_id)
                desc = (inter.get("description") or "").strip()
                label, score = infer_severity(desc)
                if score > row["severity_score"]:
                    row["severity_score"] = score
                    row["severity"] = label
                if desc and desc not in row["_desc_seen"] and len(row["descriptions"]) < 3:
                    row["descriptions"].append(desc)
                    row["_desc_seen"].add(desc)

        rows: list[dict] = []
        for row in pair_index.values():
            row["source_count"] = len(row["_source_ids"])
            row["source_ids"] = sorted(row["_source_ids"])
            pa = profile_by_id.get(row["drug_a_id"], {})
            pb = profile_by_id.get(row["drug_b_id"], {})
            ta, tb = pa.get("targets", set()), pb.get("targets", set())
            pwa, pwb = pa.get("pathways", set()), pb.get("pathways", set())
            ma, mb = pa.get("metabolic_markers", set()), pb.get("metabolic_markers", set())
            shared_t = ta & tb
            shared_m = ma & mb
            tj = jaccard(ta, tb)
            pj = jaccard(pwa, pwb)
            mj = jaccard(ma, mb)
            score = round(45.0 * tj + 35.0 * pj + 20.0 * mj, 1)
            row.update({
                "target_overlap_count": len(shared_t), "target_jaccard": tj,
                "pathway_jaccard": pj, "metabolic_overlap_count": len(shared_m),
                "metabolic_overlap_markers": sorted(shared_m)[:8],
                "inference_score": score,
                "inference_target_component": round(45.0 * tj, 1),
                "inference_pathway_component": round(35.0 * pj, 1),
                "inference_metabolic_component": round(20.0 * mj, 1),
                "inference_band": "High" if score >= 60 else ("Moderate" if score >= 30 else "Low"),
            })
            reasons = []
            if len(shared_t) > 0:
                reasons.append(f"Shared targets: {len(shared_t)} (contribution {row['inference_target_component']:.1f})")
            if pj > 0:
                reasons.append(f"Pathway similarity J={pj:.2f} (contribution {row['inference_pathway_component']:.1f})")
            if len(shared_m) > 0:
                sample = ", ".join(sorted(shared_m)[:3])
                reasons.append(f"Metabolic overlap ({sample}) contribution {row['inference_metabolic_component']:.1f}")
            if row["severity_score"] >= 3:
                reasons.append("Clinical interaction text indicates high-severity signal.")
            elif row["severity_score"] == 2:
                reasons.append("Clinical interaction text indicates moderate-severity signal.")
            if row["evidence_count"] > 1:
                reasons.append(f"Multiple supporting records: {row['evidence_count']} evidence entries.")
            row["inference_reasons"] = reasons[:3] or ["No strong mechanistic overlap found."]
            del row["_desc_seen"]
            del row["_source_ids"]
            rows.append(row)

        rows.sort(key=lambda r: (-r["severity_score"], -r.get("inference_score", 0),
                                  -r["evidence_count"], r["drug_a_name"].lower()))
        return rows

    # ── Build pharmacogenomic highlights ─────────────────────────────────────
    def build_pharmacogenomic_highlights(drugs_list: list[Drug]) -> list[dict]:
        gene_index: dict[str, Any] = {}
        for d in drugs_list or []:
            for item in (d.genomics or []):
                if not isinstance(item, dict):
                    continue
                gene = (item.get("gene") or "").strip()
                if not gene:
                    continue
                key = gene.upper()
                if key not in gene_index:
                    gene_index[key] = {"gene": key, "drug_ids": set(), "drug_names": set(),
                                       "variants": set(), "types": set(), "examples": []}
                r = gene_index[key]
                r["drug_ids"].add(d.drugbank_id)
                r["drug_names"].add(d.name)
                if item.get("variant"):
                    r["variants"].add(item["variant"].strip())
                if item.get("type"):
                    r["types"].add(item["type"].strip())
                desc = (item.get("description") or "").strip()
                if desc and len(r["examples"]) < 2:
                    r["examples"].append(desc)
        rows = [
            {"gene": r["gene"], "drug_count": len(r["drug_ids"]), "drugs": sorted(r["drug_names"]),
             "variant_count": len(r["variants"]), "variants": sorted(r["variants"])[:6],
             "types": sorted(r["types"])[:4], "examples": r["examples"]}
            for r in gene_index.values()
        ]
        rows.sort(key=lambda r: (-r["drug_count"], r["gene"]))
        return rows

    # ── Build graph nodes/edges ───────────────────────────────────────────────
    def build_graph(drugs_list: list[Drug]) -> tuple[list, list, int, int]:
        nodes: list[dict] = []
        edges: list[dict] = []
        node_ids: set[str] = set()
        edge_ids: set[tuple] = set()
        relation_cap = max(30, min(220, max_nodes_int * 2))
        interaction_cap = max(80, min(700, max_nodes_int * 6))

        def add_node(node: dict) -> bool:
            nid = node.get("id")
            if not nid or nid in node_ids or len(node_ids) >= max_nodes_int:
                return False
            node_ids.add(nid)
            nodes.append(node)
            return True

        def add_edge(edge: dict) -> bool:
            ekey = (edge.get("from"), edge.get("to"), edge.get("label") or "")
            if ekey in edge_ids:
                return False
            edge_ids.add(ekey)
            edges.append(edge)
            return True

        protein_node_by_key: dict[str, str] = {}
        gene_node_by_symbol: dict[str, str] = {}

        for idx, d in enumerate(drugs_list):
            add_node({
                "id": d.drugbank_id,
                "label": (d.name or d.drugbank_id)[:30],
                "title": f"<b>{d.name}</b><br>ID: {d.drugbank_id}<br>Type: {d.drug_type or 'N/A'}",
                "group": "drug_main" if idx == 0 else "drug_interact",
                "shape": "diamond" if idx == 0 else "dot",
                "size": 40 if idx == 0 else 28,
                "font": {"size": 14 if idx == 0 else 12, "face": "arial",
                         "color": "#ffffff", "strokeColor": "#0f172a", "strokeWidth": 4},
                "data": {"type": "drug", "drugbank_id": d.drugbank_id, "name": d.name,
                         "description": d.description or "", "mechanism": d.mechanism_of_action or ""},
            })

        def ensure_gene_node(symbol: str) -> str | None:
            s = (symbol or "").strip().upper()
            if not s:
                return None
            if s in gene_node_by_symbol:
                return gene_node_by_symbol[s]
            nid = f"gene:{_slugify(s)}"
            if add_node({"id": nid, "label": s, "title": f"<b>🧬 Gene</b><br><b>{s}</b>",
                         "group": "gene", "shape": "star", "size": 22, "data": {"type": "gene", "name": s}}):
                gene_node_by_symbol[s] = nid
                return nid
            return None

        def ensure_protein_node(protein: dict, group: str) -> str | None:
            name = (protein.get("name") or "Unknown")
            uniprot = (protein.get("uniprot_id") or "").strip()
            key = f"{group}:{uniprot or _slugify(name)}"
            if key in protein_node_by_key:
                return protein_node_by_key[key]
            gene_name = (protein.get("gene_name") or protein.get("gene") or "")
            actions = protein.get("actions") or []
            organism = protein.get("organism") or "N/A"
            function = protein.get("function") or ""
            shape_map = {"target": "hexagon", "enzyme": "square", "transporter": "triangleDown", "carrier": "ellipse"}
            nid = f"{group}:{_slugify(uniprot or name)}"
            title = (f"<b>{name}</b><br>Gene: {gene_name or 'N/A'}<br>UniProt: {uniprot or 'N/A'}"
                     f"<br>Organism: {organism}<br>Actions: {', '.join(actions) or 'N/A'}"
                     + (f"<br><br>{function}" if function else ""))
            if add_node({"id": nid, "label": str(name)[:25], "title": title, "group": group,
                         "shape": shape_map.get(group, "dot"), "size": 24,
                         "data": {"type": group, "name": name, "gene_name": gene_name,
                                  "uniprot_id": uniprot, "organism": organism,
                                  "actions": actions, "function": function}}):
                protein_node_by_key[key] = nid
                return nid
            return None

        for d in drugs_list:
            # Targets
            if f_targets:
                cnt = 0
                for t in (d.targets or []):
                    if cnt >= relation_cap or len(node_ids) >= max_nodes_int:
                        break
                    if not isinstance(t, dict):
                        continue
                    pnid = ensure_protein_node(t, "target")
                    if pnid:
                        add_edge({"from": d.drugbank_id, "to": pnid, "label": "targets",
                                  "color": {"color": "#3b82f6", "opacity": 0.7}, "width": 1})
                        if f_genes:
                            gene_sym = (t.get("gene_name") or t.get("gene") or "").strip()
                            gnid = ensure_gene_node(gene_sym) if gene_sym else None
                            if gnid:
                                add_edge({"from": pnid, "to": gnid, "label": "gene",
                                          "color": {"color": "#10b981", "opacity": 0.6}, "width": 1, "dashes": True})
                        cnt += 1

            # Enzymes
            if f_enzymes:
                cnt = 0
                for t in (d.enzymes or []):
                    if cnt >= relation_cap or len(node_ids) >= max_nodes_int:
                        break
                    if not isinstance(t, dict):
                        continue
                    pnid = ensure_protein_node(t, "enzyme")
                    if pnid:
                        add_edge({"from": d.drugbank_id, "to": pnid, "label": "enzyme",
                                  "color": {"color": "#f59e0b", "opacity": 0.7}, "width": 1, "dashes": True})
                        cnt += 1

            # Transporters
            if f_transporters:
                cnt = 0
                for t in (d.transporters or []):
                    if cnt >= relation_cap or len(node_ids) >= max_nodes_int:
                        break
                    if not isinstance(t, dict):
                        continue
                    pnid = ensure_protein_node(t, "transporter")
                    if pnid:
                        add_edge({"from": d.drugbank_id, "to": pnid, "label": "transporter",
                                  "color": {"color": "#8b5cf6", "opacity": 0.7}, "width": 1, "dashes": True})
                        cnt += 1

            # Carriers
            if f_carriers:
                cnt = 0
                for t in (d.carriers or []):
                    if cnt >= relation_cap or len(node_ids) >= max_nodes_int:
                        break
                    if not isinstance(t, dict):
                        continue
                    pnid = ensure_protein_node(t, "carrier")
                    if pnid:
                        add_edge({"from": d.drugbank_id, "to": pnid, "label": "carrier",
                                  "color": {"color": "#ec4899", "opacity": 0.7}, "width": 1, "dashes": True})
                        cnt += 1

            # Food interactions
            if f_food:
                cnt = 0
                for item in (d.food_interactions or []):
                    if cnt >= 20 or len(node_ids) >= max_nodes_int:
                        break
                    text_val = str(item or "").strip()
                    if not text_val:
                        continue
                    compact = re.sub(r"\s+", " ", text_val)
                    nid = f"food:{_slugify(compact[:50])}"
                    if add_node({"id": nid, "label": compact[:30], "title": compact,
                                 "group": "food", "shape": "ellipse", "size": 14,
                                 "data": {"type": "food", "text": compact}}):
                        add_edge({"from": d.drugbank_id, "to": nid, "label": "food",
                                  "color": {"color": "#84cc16", "opacity": 0.5}, "width": 1, "dashes": True})
                    cnt += 1

            # Drug–drug interactions
            if f_drug_interactions:
                cnt = 0
                for inter in (d.interactions or []):
                    if cnt >= interaction_cap or len(node_ids) >= max_nodes_int:
                        break
                    if not isinstance(inter, dict):
                        continue
                    other_id = (inter.get("drugbank_id") or "").strip().upper()
                    other_name = (inter.get("name") or "").strip() or other_id
                    desc = (inter.get("description") or "").strip()
                    if not other_id or other_id in selected_ids:
                        continue
                    nid = f"drug_n:{other_id}"
                    add_node({"id": nid, "label": other_name[:20], "title": f"<b>{other_name}</b><br>{desc[:120]}",
                              "group": "drug_neighbor", "shape": "dot", "size": 12,
                              "data": {"type": "drug_neighbor", "drugbank_id": other_id, "name": other_name}})
                    add_edge({"from": d.drugbank_id, "to": nid, "label": "interacts",
                              "title": desc[:100] if desc else "", "color": {"color": "#ef4444", "opacity": 0.6},
                              "width": 1.5})
                    cnt += 1

        return nodes, edges, len(node_ids), len(edge_ids)

    nodes, edges, node_count, edge_count = build_graph(selected_drugs_list)
    graph_data = json.dumps({"nodes": nodes, "edges": edges})

    comparative_targets = build_comparative_targets(selected_drugs_list)
    cross_interactions = build_cross_interactions(selected_drugs_list)
    pharmacogenomic_highlights = build_pharmacogenomic_highlights(selected_drugs_list)

    summary_totals = {
        "selected_drugs": len(selected_drugs_list),
        "targets": sum(len(d.targets or []) for d in selected_drugs_list),
        "genomics": sum(len(d.genomics or []) for d in selected_drugs_list),
        "food": sum(len(d.food_interactions or []) for d in selected_drugs_list),
        "drug_interactions": sum(len(d.interactions or []) for d in selected_drugs_list),
        "enzymes": sum(len(d.enzymes or []) for d in selected_drugs_list),
        "transporters": sum(len(d.transporters or []) for d in selected_drugs_list),
        "carriers": sum(len(d.carriers or []) for d in selected_drugs_list),
    }

    return _render("drugs/network_map.html", {
        "request": request,
        "drug": first_drug,
        "selected_drugs": selected_drugs_list,
        "selected_inputs": selected_inputs,
        "selected_display_inputs": selected_display_inputs,
        "comparative_targets": comparative_targets,
        "summary_totals": summary_totals,
        "cross_interactions": cross_interactions,
        "pharmacogenomic_highlights": pharmacogenomic_highlights,
        "graph_data": graph_data,
        "node_count": node_count,
        "edge_count": edge_count,
        "show_targets": f_targets,
        "show_genes": f_genes,
        "show_food": f_food,
        "show_drug_interactions": f_drug_interactions,
        "show_enzymes": f_enzymes,
        "show_transporters": f_transporters,
        "show_carriers": f_carriers,
        "include_neighbor_drugs": f_neighbor_drugs,
        "max_nodes": max_nodes_int,
    })
