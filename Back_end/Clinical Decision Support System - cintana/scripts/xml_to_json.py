#!/usr/bin/env python3
"""
DrugBank XML → 4 JSON Collections
====================================
Tạo ra 4 file NDJSON (một JSON object mỗi dòng):

  drugs.ndjson                       - Thông tin từng loại thuốc
  drug_interactions.ndjson           - Tương tác giữa các thuốc
  proteins.ndjson                    - Danh sách protein (UniProt)
  drug_protein_interactions.ndjson   - Liên kết thuốc ↔ protein

Usage:
  python -m scripts.xml_to_mongo_json "d:/Du_an/Database/drugbank_full.xml"
  python -m scripts.xml_to_mongo_json "d:/Du_an/Database/drugbank_full.xml" --output "d:/Du_an/Database/json_db"
"""

from __future__ import annotations

import json
import os
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

try:
    import typer
except ImportError:
    print("Cần cài typer: pip install typer")
    sys.exit(1)

app = typer.Typer(help="DrugBank XML → 4 NDJSON files (drugs, interactions, proteins, drug-protein)")

# ---------------------------------------------------------------------------
# Severity inference từ description text
# ---------------------------------------------------------------------------
_MAJOR_KEYWORDS = frozenset([
    "major", "severe", "fatal", "life-threatening", "contraindicated",
    "serious", "critically", "death", "dangerous"
])
_MINOR_KEYWORDS = frozenset(["minor", "mild", "minimal", "slight", "small", "weak"])


def infer_severity(description: str) -> str:
    if not description:
        return "unknown"
    low = description.lower()
    for kw in _MAJOR_KEYWORDS:
        if kw in low:
            return "major"
    if "moderate" in low:
        return "moderate"
    for kw in _MINOR_KEYWORDS:
        if kw in low:
            return "minor"
    return "unknown"


# ---------------------------------------------------------------------------
# XML helpers
# ---------------------------------------------------------------------------

def safe_text(node) -> Optional[str]:
    if node is None:
        return None
    text = node.text
    return text.strip() if isinstance(text, str) and text.strip() else None


def detect_ns(tag: str) -> str:
    return tag.split("}")[0] + "}" if tag.startswith("{") and "}" in tag else ""


# ---------------------------------------------------------------------------
# Extract proteins + drug-protein relations from one protein-type section
# ---------------------------------------------------------------------------

def extract_protein_entries(elem, ns: str, tag_wrapper: str, tag_item: str,
                             drug_code: str, protein_map: dict, protein_counter: list):
    """
    Trả về list các drug_protein_interaction records.
    Đồng thời cập nhật protein_map nếu gặp protein mới.

    protein_map: { uniprot_id → {id, uniprot_id, entrez_gene_id, organism, name, gene_name, ...} }
    protein_counter: [int] — dùng danh sách 1 phần tử để mutate từ bên trong (tương đương nonlocal int)
    """
    results = []
    wrapper = elem.find(f"{ns}{tag_wrapper}")
    if wrapper is None:
        return results

    for item in wrapper.findall(f"{ns}{tag_item}"):
        # ── Lấy known-action ─────────────────────────────────────────
        known_action_node = item.find(f"{ns}known-action")
        known_action = (safe_text(known_action_node) or "unknown").lower()

        # ── Lấy actions ──────────────────────────────────────────────
        actions = [
            a for a in
            (safe_text(a) for a in item.findall(f"{ns}actions/{ns}action"))
            if a
        ]

        # ── Lấy pubmed-ids từ references của entry này ───────────────
        pubmed_ids = []
        refs_node = item.find(f"{ns}references")
        if refs_node is not None:
            arts = refs_node.find(f"{ns}articles")
            if arts is not None:
                for article in arts.findall(f"{ns}article"):
                    pm = safe_text(article.find(f"{ns}pubmed-id"))
                    if pm:
                        pubmed_ids.append(pm)

        # ── Lấy thông tin protein ────────────────────────────────────
        gene_name: Optional[str] = None
        uniprot_id: Optional[str] = None
        entrez_gene_id: Optional[str] = None
        organism: Optional[str] = None
        protein_name = safe_text(item.find(f"{ns}name"))

        poly = item.find(f"{ns}polypeptide")
        if poly is not None:
            gene_name = safe_text(poly.find(f"{ns}gene-name"))
            organism = safe_text(poly.find(f"{ns}organism"))

            for ext in poly.findall(f"{ns}external-identifiers/{ns}external-identifier"):
                resource = safe_text(ext.find(f"{ns}resource"))
                identifier = safe_text(ext.find(f"{ns}identifier"))
                if not resource or not identifier:
                    continue
                if resource in ("UniProtKB", "UniProt Accession"):
                    uniprot_id = identifier
                elif resource == "Entrez Gene":
                    entrez_gene_id = identifier

        # ── Đăng ký protein mới ──────────────────────────────────────
        protein_id: Optional[int] = None
        if uniprot_id:
            if uniprot_id not in protein_map:
                protein_counter[0] += 1
                pid = protein_counter[0]
                protein_map[uniprot_id] = {
                    "id": pid,
                    "uniprot_id": uniprot_id,
                    "entrez_gene_id": entrez_gene_id,
                    "organism": organism or "Unknown",
                    "name": protein_name,
                    "gene_name": gene_name,
                }
            protein_id = protein_map[uniprot_id]["id"]

        # ── Tạo drug_protein_interaction record ──────────────────────
        if protein_id is not None:
            results.append({
                "drug_id": drug_code,
                "protein_id": protein_id,
                "uniprot_id": uniprot_id,
                "interaction_type": tag_item,   # "target" | "enzyme" | "transporter" | "carrier"
                "known_action": known_action,    # "yes" | "no" | "unknown"
                "actions": actions,
                "pubmed_ids": pubmed_ids,
            })

    return results


# ---------------------------------------------------------------------------
# Main conversion command
# ---------------------------------------------------------------------------

@app.command()
def convert(
    xml_file: str = typer.Argument(..., help="Đường dẫn tới file DrugBank XML"),
    output: str = typer.Option("", "--output", "-o", help="Thư mục output"),
    progress: int = typer.Option(1000, "--progress", "-p", help="Log mỗi N thuốc"),
):
    """
    Chuyển DrugBank XML → 4 NDJSON files:
    drugs | drug_interactions | proteins | drug_protein_interactions
    """
    xml_path = Path(xml_file)
    if not xml_path.exists():
        typer.echo(f"[LỖI] Không tìm thấy: {xml_file}", err=True)
        raise typer.Exit(1)

    out_dir = Path(output) if output else xml_path.parent / "mongo"
    out_dir.mkdir(parents=True, exist_ok=True)

    typer.echo(f"📁 Output : {out_dir.resolve()}")
    typer.echo(f"📄 Input  : {xml_path.resolve()}")
    typer.echo("-" * 65)

    # ── Output file handles (stream write — tiết kiệm RAM) ──────────
    f_drugs       = open(out_dir / "drugs.ndjson",                   "w", encoding="utf-8")
    f_interactions = open(out_dir / "drug_interactions.ndjson",       "w", encoding="utf-8")
    f_dpi          = open(out_dir / "drug_protein_interactions.ndjson","w", encoding="utf-8")

    # ── In-memory collections (nhỏ) ─────────────────────────────────
    protein_map: dict = {}          # uniprot_id → protein document
    protein_counter = [0]           # mutable counter: [current_max_id]

    ns: Optional[str] = None
    drug_tag: Optional[str] = None

    # Counters
    drug_seq = 0           # sequential drug number → DR:XXXXX
    cnt_drug = 0
    cnt_intx = 0
    cnt_dpi  = 0
    start_time = time.monotonic()

    typer.echo("🚀 Bắt đầu parse XML...")

    context = ET.iterparse(str(xml_path), events=("start", "end"))

    for event, elem in context:
        # ── Detect namespace ─────────────────────────────────────────
        if event == "start" and ns is None:
            ns = detect_ns(elem.tag)
            drug_tag = f"{ns}drug"
            typer.echo(f"   Namespace: {ns or '(none)'}")
            continue

        if event != "end" or elem.tag != drug_tag:
            continue

        # Bỏ qua stub entries (không có type attribute)
        if not elem.get("type"):
            elem.clear()
            continue

        # ── Drug identity ─────────────────────────────────────────
        primary_id: Optional[str] = None
        secondary_ids: list = []
        for id_elem in elem.findall(f"{ns}drugbank-id"):
            txt = (id_elem.text or "").strip()
            if not txt:
                continue
            is_primary = (id_elem.get("primary") or "").lower() in ("true", "1", "yes")
            if is_primary:
                primary_id = txt
            else:
                secondary_ids.append(txt)

        drugbank_id = primary_id or (secondary_ids[0] if secondary_ids else None)
        if not drugbank_id:
            elem.clear()
            continue

        drug_seq += 1
        drug_code = f"DR:{drug_seq:05d}"     # DR:00001, DR:00002, ...

        # ------------------------------------------------------------------
        # 1. COLLECTION: drugs
        # ------------------------------------------------------------------
        name   = safe_text(elem.find(f"{ns}name")) or drugbank_id
        dtype  = elem.get("type") or ""

        # groups → pipe-separated string (approved|investigational|...)
        groups_list = [
            g for g in (safe_text(g) for g in elem.findall(f"{ns}groups/{ns}group")) if g
        ]
        groups_str = "|".join(groups_list)

        # ATC codes → pipe-separated string
        atc_codes_list: list[str] = []
        atc_node = elem.find(f"{ns}atc-codes")
        if atc_node is not None:
            for atc in atc_node.findall(f"{ns}atc-code"):
                code = (atc.get("code") or "").strip()
                if code:
                    atc_codes_list.append(code)
        atc_codes_str = "|".join(atc_codes_list) if atc_codes_list else ""

        # categories → Array
        categories: list[dict] = []
        for cat in elem.findall(f"{ns}categories/{ns}category"):
            cat_name = safe_text(cat.find(f"{ns}category"))
            if cat_name:
                categories.append({
                    "name": cat_name,
                    "mesh_id": safe_text(cat.find(f"{ns}mesh-id")),
                })

        # aliases → Array (synonyms)
        aliases: list[str] = [
            s for s in (safe_text(s) for s in elem.findall(f"{ns}synonyms/{ns}synonym")) if s
        ]

        # components → Array (salts + mixtures as ingredients)
        components: list[dict] = []
        salts_node = elem.find(f"{ns}salts")
        if salts_node is not None:
            for salt in salts_node.findall(f"{ns}salt"):
                sname = safe_text(salt.find(f"{ns}name"))
                salt_ids = [
                    (ie.text or "").strip()
                    for ie in salt.findall(f"{ns}drugbank-id")
                    if (ie.text or "").strip()
                ]
                if sname or salt_ids:
                    components.append({
                        "component_type": "salt",
                        "name": sname,
                        "drugbank_ids": salt_ids,
                        "cas_number": safe_text(salt.find(f"{ns}cas-number")),
                        "formula": safe_text(salt.find(f"{ns}formula")),
                        "smiles": safe_text(salt.find(f"{ns}smiles")),
                    })

        mixes_node = elem.find(f"{ns}mixtures")
        if mixes_node is not None:
            for mix in mixes_node.findall(f"{ns}mixture"):
                mname = safe_text(mix.find(f"{ns}name"))
                if mname:
                    components.append({
                        "component_type": "mixture",
                        "name": mname,
                        "ingredients": safe_text(mix.find(f"{ns}ingredients")),
                    })

        # chemical_properties → Object
        inchikey: Optional[str] = None
        inchi: Optional[str] = None
        smiles: Optional[str] = None
        mol_formula: Optional[str] = None
        mol_weight: Optional[str] = None
        avg_mass: Optional[str] = None

        calc = elem.find(f"{ns}calculated-properties")
        if calc is not None:
            for prop in calc.findall(f"{ns}property"):
                kind = safe_text(prop.find(f"{ns}kind"))
                val  = safe_text(prop.find(f"{ns}value"))
                if kind == "InChIKey":               inchikey   = val
                elif kind == "InChI":                inchi      = val
                elif kind == "SMILES":               smiles     = val
                elif kind == "Molecular Formula":    mol_formula = val
                elif kind == "Molecular Weight":     mol_weight = val

        avg_mass_node = elem.find(f"{ns}average-mass")
        if avg_mass_node is not None:
            avg_mass = safe_text(avg_mass_node)

        chemical_properties = {
            "smiles": smiles or "",
            "molecular_formula": mol_formula or "",
            "molecular_weight": mol_weight or "",
            "average_mass": avg_mass or "",
        }

        # external_mappings → Object { resource: identifier }
        external_mappings: dict = {}
        ei_node = elem.find(f"{ns}external-identifiers")
        if ei_node is not None:
            for ext in ei_node.findall(f"{ns}external-identifier"):
                res = safe_text(ext.find(f"{ns}resource"))
                idd = safe_text(ext.find(f"{ns}identifier"))
                if res and idd:
                    external_mappings[res] = idd

        drug_doc = {
            "drug_code": drug_code,
            "drugbank_id": drugbank_id,
            "name": name,
            "type": dtype,
            "groups": groups_str,
            "atc_codes": atc_codes_str,
            "categories": categories,
            "inchikey": inchikey or "",
            "inchi": inchi or "",
            "description": safe_text(elem.find(f"{ns}description")) or "",
            "indication": safe_text(elem.find(f"{ns}indication")) or "",
            "mechanism_of_action": safe_text(elem.find(f"{ns}mechanism-of-action")) or "",
            "pharmacodynamics": safe_text(elem.find(f"{ns}pharmacodynamics")) or "",
            "toxicity": safe_text(elem.find(f"{ns}toxicity")) or "",
            "metabolism": safe_text(elem.find(f"{ns}metabolism")) or "",
            "absorption": safe_text(elem.find(f"{ns}absorption")) or "",
            "half_life": safe_text(elem.find(f"{ns}half-life")) or "",
            "protein_binding": safe_text(elem.find(f"{ns}protein-binding")) or "",
            "route_of_elimination": safe_text(elem.find(f"{ns}route-of-elimination")) or "",
            "aliases": aliases,
            "components": components,
            "chemical_properties": chemical_properties,
            "external_mappings": external_mappings,
            "cas_number": safe_text(elem.find(f"{ns}cas-number")) or "",
            "unii": safe_text(elem.find(f"{ns}unii")) or "",
            "state": safe_text(elem.find(f"{ns}state")) or "",
        }
        f_drugs.write(json.dumps(drug_doc, ensure_ascii=False, default=str) + "\n")
        cnt_drug += 1

        # ------------------------------------------------------------------
        # 2. COLLECTION: drug_interactions
        # ------------------------------------------------------------------
        for intx in elem.findall(f"{ns}drug-interactions/{ns}drug-interaction"):
            partner_id   = safe_text(intx.find(f"{ns}drugbank-id"))
            partner_name = safe_text(intx.find(f"{ns}name"))
            desc         = safe_text(intx.find(f"{ns}description")) or ""

            if not partner_id:
                continue

            intx_doc = {
                "drug_id": drug_code,
                "interacting_drug_id": partner_id,
                "severity": infer_severity(desc),
                "description": desc,
            }
            f_interactions.write(json.dumps(intx_doc, ensure_ascii=False, default=str) + "\n")
            cnt_intx += 1

        # ------------------------------------------------------------------
        # 3 & 4. COLLECTION: proteins + drug_protein_interactions
        #         (targets, enzymes, transporters, carriers)
        # ------------------------------------------------------------------
        for wrapper_tag, item_tag in [
            ("targets",      "target"),
            ("enzymes",      "enzyme"),
            ("transporters", "transporter"),
            ("carriers",     "carrier"),
        ]:
            dpi_records = extract_protein_entries(
                elem, ns, wrapper_tag, item_tag,
                drug_code, protein_map, protein_counter
            )
            for rec in dpi_records:
                f_dpi.write(json.dumps(rec, ensure_ascii=False, default=str) + "\n")
                cnt_dpi += 1

        # Progress log
        if progress > 0 and cnt_drug % progress == 0:
            elapsed = time.monotonic() - start_time
            rate = cnt_drug / elapsed if elapsed > 0 else 0
            typer.echo(
                f"   [{cnt_drug:>6,}] drugs | interactions={cnt_intx:,} "
                f"| proteins={len(protein_map):,} | dpi={cnt_dpi:,} | {rate:.0f} d/s"
            )

        elem.clear()

    # Close streaming files
    f_drugs.close()
    f_interactions.close()
    f_dpi.close()

    elapsed_total = time.monotonic() - start_time
    typer.echo("-" * 65)
    typer.echo(f"✅ Parse xong: {cnt_drug:,} thuốc | {elapsed_total:.1f}s")

    # ------------------------------------------------------------------
    # Ghi proteins.ndjson (sau khi có đầy đủ dữ liệu)
    # ------------------------------------------------------------------
    typer.echo("📦 Ghi proteins.ndjson...")
    with open(out_dir / "proteins.ndjson", "w", encoding="utf-8") as fp:
        for prot in sorted(protein_map.values(), key=lambda x: x["id"]):
            fp.write(json.dumps(prot, ensure_ascii=False, default=str) + "\n")

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    def fsize(p: Path) -> str:
        mb = p.stat().st_size / (1024 * 1024)
        return f"{mb:>7.1f} MB"

    typer.echo("\n" + "=" * 65)
    typer.echo("📊 KẾT QUẢ")
    typer.echo("=" * 65)
    rows = [
        ("drugs.ndjson",                    cnt_drug),
        ("drug_interactions.ndjson",         cnt_intx),
        ("proteins.ndjson",                  len(protein_map)),
        ("drug_protein_interactions.ndjson", cnt_dpi),
    ]
    for fname, count in rows:
        path = out_dir / fname
        typer.echo(f"  {fname:<44} {count:>8,} docs  {fsize(path)}")

    typer.echo("=" * 65)
    typer.echo(f"\n✅ Output folder: {out_dir.resolve()}")


if __name__ == "__main__":
    app()
