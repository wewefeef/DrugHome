"""
DrugBank XML importer — replaces drugs/management/commands/load_drugbank.py.

Usage:
    python -m scripts.load_drugbank path/to/drugbank_full.xml
    python -m scripts.load_drugbank path/to/drugbank_full.xml --reset
    python -m scripts.load_drugbank path/to/drugbank_full.xml --only DB00001 --only DB00002
    python -m scripts.load_drugbank path/to/drugbank_full.xml --progress 200
"""

import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import typer
from sqlalchemy import select
from sqlalchemy.dialects.mysql import insert as mysql_insert

# Ensure project root is on sys.path when running as a script
_project_root = Path(__file__).resolve().parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from app.database import SessionLocal, engine
from app.models import Base, Drug

app = typer.Typer(add_completion=False)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe_text(node) -> str | None:
    if node is None:
        return None
    text = node.text
    return text.strip() if isinstance(text, str) and text.strip() else None


def _safe_float(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_bool(value: str | None) -> bool | None:
    if value is None:
        return None
    v = str(value).strip().lower()
    if v in {"true", "1", "yes"}:
        return True
    if v in {"false", "0", "no"}:
        return False
    return None


def _detect_namespace(tag: str) -> str:
    if isinstance(tag, str) and tag.startswith("{") and "}" in tag:
        return tag.split("}", 1)[0] + "}"
    return ""


# ── Core parser ──────────────────────────────────────────────────────────────

def _process_drug(elem: ET.Element, ns: str, only_set: set[str]) -> dict | None:
    """Parse a <drug> XML element and return a dict ready for DB upsert, or None to skip."""

    def get_text(tag: str) -> str | None:
        return _safe_text(elem.find(f"{ns}{tag}"))

    # --- 1. PRIMARY IDENTITY ---
    ids, primary_id = [], None
    for id_elem in elem.findall(f"{ns}drugbank-id"):
        text = (_safe_text(id_elem) or "")
        if text:
            ids.append(text)
            if (id_elem.get("primary") or "").strip().lower() in {"true", "1", "yes"}:
                primary_id = text

    db_id = primary_id or (ids[0] if ids else None)
    if not db_id:
        return None

    if only_set and db_id not in only_set:
        return None

    # --- 2. SIMPLE LIST DATA ---
    groups = [_safe_text(g) for g in elem.findall(f"{ns}groups/{ns}group") if _safe_text(g)]
    synonyms = [_safe_text(s) for s in elem.findall(f"{ns}synonyms/{ns}synonym") if _safe_text(s)]
    categories = []
    for cat in elem.findall(f"{ns}categories/{ns}category"):
        cat_name = _safe_text(cat.find(f"{ns}category"))
        mesh_id = _safe_text(cat.find(f"{ns}mesh-id"))
        if cat_name:
            categories.append({"category": cat_name, "mesh_id": mesh_id})

    # --- 3. INTERACTIONS ---
    interactions = []
    for interact in elem.findall(f"{ns}drug-interactions/{ns}drug-interaction"):
        i_id = _safe_text(interact.find(f"{ns}drugbank-id"))
        i_name = _safe_text(interact.find(f"{ns}name"))
        i_desc = _safe_text(interact.find(f"{ns}description"))
        if i_id and i_name:
            interactions.append({"drugbank_id": i_id, "name": i_name, "description": i_desc or ""})

    food_interactions = [
        _safe_text(f) for f in elem.findall(f"{ns}food-interactions/{ns}food-interaction")
        if _safe_text(f)
    ]

    # --- 4. PROTEIN DATA ---
    def extract_protein_data(tag_wrapper: str, tag_item: str) -> list[dict]:
        data_list = []
        wrapper = elem.find(f"{ns}{tag_wrapper}")
        if wrapper is None:
            return data_list
        for item in wrapper.findall(f"{ns}{tag_item}"):
            p_name = _safe_text(item.find(f"{ns}name"))
            if not p_name:
                continue
            p_org = _safe_text(item.find(f"{ns}organism")) or "N/A"
            p_actions = [_safe_text(a) for a in item.findall(f"{ns}actions/{ns}action") if _safe_text(a)]
            gene_name, uniprot_id, external_ids = "-", None, {}
            aa_sequence, gene_sequence = None, None
            poly = item.find(f"{ns}polypeptide")
            if poly is not None:
                g_node = poly.find(f"{ns}gene-name")
                gene_name = _safe_text(g_node) or gene_name
                for ext in poly.findall(f"{ns}external-identifiers/{ns}external-identifier"):
                    resource = _safe_text(ext.find(f"{ns}resource"))
                    identifier = _safe_text(ext.find(f"{ns}identifier"))
                    if resource and identifier:
                        external_ids[resource] = identifier
                uniprot_id = external_ids.get("UniProtKB") or external_ids.get("UniProt Accession")
                aa_sequence = _safe_text(poly.find(f"{ns}amino-acid-sequence"))
                gene_sequence = _safe_text(poly.find(f"{ns}gene-sequence"))
            p_function = None
            fnode = item.find(f"{ns}function") or item.find(f"{ns}general-function")
            if _safe_text(fnode):
                p_function = _safe_text(fnode)
            elif poly is not None:
                pf = poly.find(f"{ns}function") or poly.find(f"{ns}general-function")
                if _safe_text(pf):
                    p_function = _safe_text(pf)
            data_list.append({
                "name": p_name, "organism": p_org, "actions": p_actions,
                "gene_name": gene_name, "uniprot_id": uniprot_id, "function": p_function,
                "external_ids": external_ids, "aa_sequence": aa_sequence, "gene_sequence": gene_sequence,
            })
        return data_list

    targets = extract_protein_data("targets", "target")
    enzymes = extract_protein_data("enzymes", "enzyme")
    transporters = extract_protein_data("transporters", "transporter")
    carriers = extract_protein_data("carriers", "carrier")

    # --- 5. PHARMACOGENOMICS ---
    genomics_data = []
    snp_effects = elem.find(f"{ns}snp-effects")
    if snp_effects is not None:
        for effect in snp_effects.findall(f"{ns}effect"):
            gene = _safe_text(effect.find(f"{ns}gene-symbol"))
            rs_id = _safe_text(effect.find(f"{ns}rs-id"))
            desc = _safe_text(effect.find(f"{ns}description"))
            if gene and desc:
                genomics_data.append({"gene": gene, "variant": rs_id, "type": "Effect", "description": desc})
    snp_adverse = elem.find(f"{ns}snp-adverse-drug-reactions")
    if snp_adverse is not None:
        for reaction in snp_adverse.findall(f"{ns}reaction"):
            gene = _safe_text(reaction.find(f"{ns}gene-symbol"))
            rs_id = _safe_text(reaction.find(f"{ns}rs-id"))
            desc = _safe_text(reaction.find(f"{ns}description"))
            if gene and desc:
                genomics_data.append({"gene": gene, "variant": rs_id, "type": "Adverse", "description": desc})

    # --- 6. SMILES ---
    smiles_code = None
    calc_props = elem.find(f"{ns}calculated-properties")
    if calc_props is not None:
        for prop in calc_props.findall(f"{ns}property"):
            if _safe_text(prop.find(f"{ns}kind")) == "SMILES":
                smiles_code = _safe_text(prop.find(f"{ns}value"))
                break

    # --- 6b. REFERENCES ---
    general_references = {"articles": [], "textbooks": [], "links": [], "attachments": []}
    gr = elem.find(f"{ns}general-references")
    if gr is not None:
        articles = gr.find(f"{ns}articles")
        if articles is not None:
            for a in articles.findall(f"{ns}article"):
                pubmed_id = _safe_text(a.find(f"{ns}pubmed-id"))
                citation = _safe_text(a.find(f"{ns}citation"))
                ref_id = _safe_text(a.find(f"{ns}ref-id"))
                if pubmed_id or citation:
                    general_references["articles"].append({"pubmed_id": pubmed_id, "citation": citation, "ref_id": ref_id})
        textbooks = gr.find(f"{ns}textbooks")
        if textbooks is not None:
            for t in textbooks.findall(f"{ns}textbook"):
                isbn = _safe_text(t.find(f"{ns}isbn"))
                citation = _safe_text(t.find(f"{ns}citation"))
                ref_id = _safe_text(t.find(f"{ns}ref-id"))
                if isbn or citation:
                    general_references["textbooks"].append({"isbn": isbn, "citation": citation, "ref_id": ref_id})
        links = gr.find(f"{ns}links")
        if links is not None:
            for lk in links.findall(f"{ns}link"):
                title = _safe_text(lk.find(f"{ns}title"))
                url = _safe_text(lk.find(f"{ns}url"))
                ref_id = _safe_text(lk.find(f"{ns}ref-id"))
                if title or url:
                    general_references["links"].append({"title": title, "url": url, "ref_id": ref_id})
        attachments = gr.find(f"{ns}attachments")
        if attachments is not None:
            for at in attachments.findall(f"{ns}attachment"):
                title = _safe_text(at.find(f"{ns}title"))
                url = _safe_text(at.find(f"{ns}url"))
                ref_id = _safe_text(at.find(f"{ns}ref-id"))
                if title or url:
                    general_references["attachments"].append({"title": title, "url": url, "ref_id": ref_id})
    synthesis_reference = get_text("synthesis-reference")

    # --- 6c. PRODUCTS / BRANDS / EXT IDS / SEQUENCES ---
    products = []
    products_node = elem.find(f"{ns}products")
    if products_node is not None:
        for p in products_node.findall(f"{ns}product"):
            p_name = _safe_text(p.find(f"{ns}name"))
            if not p_name:
                continue
            products.append({
                "name": p_name,
                "labeller": _safe_text(p.find(f"{ns}labeller")),
                "dosage_form": _safe_text(p.find(f"{ns}dosage-form")),
                "strength": _safe_text(p.find(f"{ns}strength")),
                "route": _safe_text(p.find(f"{ns}route")),
                "country": _safe_text(p.find(f"{ns}country")),
                "source": _safe_text(p.find(f"{ns}source")),
                "generic": _safe_bool(_safe_text(p.find(f"{ns}generic"))),
                "over_the_counter": _safe_bool(_safe_text(p.find(f"{ns}over-the-counter"))),
                "approved": _safe_bool(_safe_text(p.find(f"{ns}approved"))),
                "started_marketing_on": _safe_text(p.find(f"{ns}started-marketing-on")),
                "ended_marketing_on": _safe_text(p.find(f"{ns}ended-marketing-on")),
                "fda_application_number": _safe_text(p.find(f"{ns}fda-application-number")),
                "ndc_id": _safe_text(p.find(f"{ns}ndc-id")),
            })

    international_brands = []
    ib_node = elem.find(f"{ns}international-brands")
    if ib_node is not None:
        for b in ib_node.findall(f"{ns}international-brand"):
            b_name = _safe_text(b.find(f"{ns}name"))
            if b_name:
                international_brands.append({"name": b_name, "company": _safe_text(b.find(f"{ns}company"))})

    external_identifiers = []
    ei_node = elem.find(f"{ns}external-identifiers")
    if ei_node is not None:
        for ext in ei_node.findall(f"{ns}external-identifier"):
            resource = _safe_text(ext.find(f"{ns}resource"))
            identifier = _safe_text(ext.find(f"{ns}identifier"))
            if resource and identifier:
                external_identifiers.append({"resource": resource, "identifier": identifier})

    external_links = []
    el_node = elem.find(f"{ns}external-links")
    if el_node is not None:
        for link in el_node.findall(f"{ns}external-link"):
            resource = _safe_text(link.find(f"{ns}resource"))
            url = _safe_text(link.find(f"{ns}url"))
            if resource or url:
                external_links.append({"resource": resource, "url": url})

    sequences = []
    seqs_node = elem.find(f"{ns}sequences")
    if seqs_node is not None:
        for s in seqs_node.findall(f"{ns}sequence"):
            entry = {"sequence": _safe_text(s), **dict(s.attrib or {})}
            sequences.append(entry)

    raw_xml_payload = ET.tostring(elem, encoding="unicode")

    return {
        "drugbank_id": db_id,
        "name": get_text("name") or db_id,
        "description": get_text("description"),
        "drug_type": elem.get("type"),
        "cas_number": get_text("cas-number"),
        "unii": get_text("unii"),
        "state": get_text("state"),
        "indication": get_text("indication"),
        "pharmacodynamics": get_text("pharmacodynamics"),
        "mechanism_of_action": get_text("mechanism-of-action"),
        "toxicity": get_text("toxicity"),
        "metabolism": get_text("metabolism"),
        "absorption": get_text("absorption"),
        "half_life": get_text("half-life"),
        "route_of_elimination": get_text("route-of-elimination"),
        "volume_of_distribution": get_text("volume-of-distribution"),
        "clearance": get_text("clearance"),
        "average_mass": _safe_float(get_text("average-mass")),
        "monoisotopic_mass": _safe_float(get_text("monoisotopic-mass")),
        "groups": groups,
        "synonyms": synonyms,
        "categories": categories,
        "interactions": interactions,
        "food_interactions": food_interactions,
        "genomics": genomics_data,
        "targets": targets,
        "enzymes": enzymes,
        "transporters": transporters,
        "carriers": carriers,
        "smiles": smiles_code,
        "general_references": general_references,
        "synthesis_reference": synthesis_reference,
        "external_identifiers": external_identifiers,
        "external_links": external_links,
        "products": products,
        "international_brands": international_brands,
        "sequences": sequences,
        "raw_xml": raw_xml_payload,
    }


# ── Typer CLI ─────────────────────────────────────────────────────────────────

@app.command()
def load_drugbank(
    xml_file: str = typer.Argument(..., help="Path to DrugBank XML file"),
    reset: bool = typer.Option(False, "--reset", help="Delete all rows before import"),
    only: list[str] = typer.Option([], "--only", help="Import only specific DrugBank IDs (repeatable)"),
    progress: int = typer.Option(500, "--progress", help="Log progress every N drugs"),
    batch_size: int = typer.Option(100, "--batch", help="DB upsert batch size"),
):
    """Import DrugBank XML into MySQL via SQLAlchemy."""

    if not os.path.exists(xml_file):
        typer.echo(f"[ERROR] File not found: {xml_file}", err=True)
        raise typer.Exit(1)

    # Ensure tables exist
    Base.metadata.create_all(bind=engine)

    only_set = {s.strip() for s in only if s.strip()}

    with SessionLocal() as db:
        if reset:
            typer.echo("[WARN] --reset: deleting all Drug rows...")
            db.query(Drug).delete()
            db.commit()
            typer.echo("[OK] Drug table cleared.")

        typer.echo(f"[INFO] Starting import from: {xml_file}")

        context = ET.iterparse(xml_file, events=("start", "end"))
        ns: str = ""
        drug_tag: str = ""
        seen = saved = skipped = failed = 0
        batch: list[dict] = []

        def flush_batch():
            nonlocal saved
            if not batch:
                return
            # MySQL upsert: INSERT … ON DUPLICATE KEY UPDATE
            stmt = mysql_insert(Drug.__table__).values(batch)
            update_cols = {c.name: stmt.inserted[c.name] for c in Drug.__table__.columns if c.name != "drugbank_id"}
            db.execute(stmt.on_duplicate_key_update(**update_cols))
            db.commit()
            saved += len(batch)
            batch.clear()

        for event, elem in context:
            if event == "start" and not ns:
                ns = _detect_namespace(elem.tag)
                drug_tag = f"{ns}drug"
                typer.echo(f"[INFO] Detected namespace: {ns or '(none)'}")
                continue

            if event == "end" and elem.tag == drug_tag:
                # Skip stub entries (no type attr) that might overwrite richer rows
                if not elem.get("type"):
                    elem.clear()
                    continue

                seen += 1
                try:
                    record = _process_drug(elem, ns, only_set)
                    if record:
                        batch.append(record)
                        if len(batch) >= batch_size:
                            flush_batch()
                    else:
                        skipped += 1
                except Exception as exc:
                    failed += 1
                    typer.echo(f"[WARN] Drug #{seen} failed: {exc}", err=True)
                finally:
                    elem.clear()

                if progress > 0 and seen % progress == 0:
                    typer.echo(f"[PROGRESS] seen={seen:,} saved={saved:,} skipped={skipped:,} failed={failed:,}")

        # Flush remaining
        flush_batch()

        total_rows = db.query(Drug).count()

    typer.echo(
        f"[DONE] seen={seen:,} saved={saved:,} skipped={skipped:,} failed={failed:,} | "
        f"Total rows in DB: {total_rows:,}"
    )


if __name__ == "__main__":
    app()
