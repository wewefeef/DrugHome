import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import ForceGraph2D, { type NodeObject, type LinkObject } from "react-force-graph-2d";
import {
  Zap, Search, X, ChevronRight, Plus, Loader2, RefreshCw, Maximize2,
  ExternalLink, AlertTriangle, AlertCircle, CheckCircle2, Info,
} from "lucide-react";
import { getDrugs } from "../lib/drugCache";
import { apiSearchDrugs, apiFetchDrugsByCategory, apiFetchDrugNetwork } from "../lib/api";
import type { DrugNetworkData } from "../lib/api";

/* ────────────────── TYPES ────────────────── */
interface DrugEntry { id: string; name: string; }
interface DrugCategory { key: string; label: string; icon: string; color: string; count: number; drugs: DrugEntry[]; }
type NodeType = "drug_main" | "drug_int" | "target" | "enzyme" | "transporter" | "carrier" | "gene";

interface GraphNode extends NodeObject {
  nodeId: string; label: string; subLabel?: string; nodeType: NodeType;
  description?: string; mechanism?: string; actions?: string[]; groups?: string[]; severity?: string;
}
interface GraphLink extends LinkObject { linkLabel?: string; severity?: string; }

/* ────────────────── CONSTANTS ────────────────── */
const CAT_COLORS: Record<string, { bg: string; tx: string; rg: string }> = {
  red:    { bg: "bg-red-950/60",     tx: "text-red-300",     rg: "ring-red-500/60"     },
  rose:   { bg: "bg-rose-950/60",    tx: "text-rose-300",    rg: "ring-rose-500/60"    },
  green:  { bg: "bg-emerald-950/60", tx: "text-emerald-300", rg: "ring-emerald-500/60" },
  blue:   { bg: "bg-blue-950/60",    tx: "text-blue-300",    rg: "ring-blue-500/60"    },
  amber:  { bg: "bg-amber-950/60",   tx: "text-amber-300",   rg: "ring-amber-500/60"   },
  violet: { bg: "bg-violet-950/60",  tx: "text-violet-300",  rg: "ring-violet-500/60"  },
  purple: { bg: "bg-purple-950/60",  tx: "text-purple-300",  rg: "ring-purple-500/60"  },
  orange: { bg: "bg-orange-950/60",  tx: "text-orange-300",  rg: "ring-orange-500/60"  },
  sky:    { bg: "bg-sky-950/60",     tx: "text-sky-300",     rg: "ring-sky-500/60"     },
  teal:   { bg: "bg-teal-950/60",    tx: "text-teal-300",    rg: "ring-teal-500/60"    },
  yellow: { bg: "bg-yellow-950/60",  tx: "text-yellow-300",  rg: "ring-yellow-500/60"  },
  cyan:   { bg: "bg-cyan-950/60",    tx: "text-cyan-300",    rg: "ring-cyan-500/60"    },
  stone:  { bg: "bg-stone-950/60",   tx: "text-stone-300",   rg: "ring-stone-500/60"   },
};

const NODE_STYLES: Record<NodeType, { color: string; size: number; shape: string; label: string }> = {
  drug_main:   { color: "#1d4ed8", size: 12, shape: "diamond",  label: "Main Drug"        },
  drug_int:    { color: "#f97316", size: 7,  shape: "circle",   label: "Interacting Drug" },
  target:      { color: "#ef4444", size: 7,  shape: "hexagon",  label: "Protein Target"   },
  enzyme:      { color: "#06b6d4", size: 6,  shape: "square",   label: "Enzyme"           },
  transporter: { color: "#22c55e", size: 6,  shape: "square",   label: "Transporter"      },
  carrier:     { color: "#f59e0b", size: 5,  shape: "circle",   label: "Carrier"          },
  gene:        { color: "#a855f7", size: 5,  shape: "star",     label: "Gene/Genomics"    },
};

const FILTER_TYPES: { key: NodeType; label: string }[] = [
  { key: "target",      label: "Protein Target"   },
  { key: "gene",        label: "Gene/Genomics"     },
  { key: "drug_int",    label: "Drug Interactions" },
  { key: "enzyme",      label: "Enzyme"            },
  { key: "transporter", label: "Transporter"       },
  { key: "carrier",     label: "Carrier"           },
];

const SEV_STYLE: Record<string, { bg: string; border: string; text: string; label: string; icon: string }> = {
  major:    { bg: "#ef444420", border: "#ef444460", text: "#fca5a5", label: "High Risk",  icon: "🔴" },
  moderate: { bg: "#f59e0b20", border: "#f59e0b60", text: "#fcd34d", label: "Moderate",   icon: "🟡" },
  minor:    { bg: "#22c55e20", border: "#22c55e60", text: "#86efac", label: "Low Risk",   icon: "🟢" },
};
const normSev = (s: string) => (s === "major" || s === "moderate" || s === "minor") ? s : "minor";
const RECOMMENDATIONS: Record<string, string> = {
  major:    "Avoid concurrent use. Seek alternative medications. If unavoidable, monitor closely and adjust doses.",
  moderate: "Monitor closely. Consider dose adjustment if adverse effects appear. Consult a specialist if needed.",
  minor:    "Routine monitoring is generally sufficient. Monitor for signs of adverse effects.",
};

/* ────────────────── DRAW HELPERS ────────────────── */
function drawNodeShape(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, shape: string, color: string, isSelected: boolean) {
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.strokeStyle = isSelected ? "#ffffff" : "#ffffff33";
  ctx.lineWidth = isSelected ? 2.5 : 1.2;
  if (shape === "circle") {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  } else if (shape === "diamond") {
    ctx.moveTo(x, y - r * 1.4); ctx.lineTo(x + r * 1.1, y);
    ctx.lineTo(x, y + r * 1.4); ctx.lineTo(x - r * 1.1, y); ctx.closePath();
  } else if (shape === "hexagon") {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      if (i === 0) ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
      else ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    ctx.closePath();
  } else if (shape === "triangle") {
    ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.0, y + r * 0.8);
    ctx.lineTo(x - r * 1.0, y + r * 0.8); ctx.closePath();
  } else if (shape === "square") {
    const s = r * 1.1;
    ctx.rect(x - s, y - s, s * 2, s * 2);
  } else if (shape === "star") {
    const spikes = 5, outerR = r, innerR = r * 0.45;
    for (let i = 0; i < spikes * 2; i++) {
      const angle = (i * Math.PI) / spikes - Math.PI / 2;
      const rad = i % 2 === 0 ? outerR : innerR;
      if (i === 0) ctx.moveTo(x + rad * Math.cos(angle), y + rad * Math.sin(angle));
      else ctx.lineTo(x + rad * Math.cos(angle), y + rad * Math.sin(angle));
    }
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  if (isSelected) {
    ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
    ctx.strokeStyle = color + "66"; ctx.lineWidth = 1.5; ctx.stroke();
  }
}

/* ────────────────── NODE DETAIL PANEL ────────────────── */
function NodeDetailPanel({
  node, networkDrugs, networkData, onClose,
}: {
  node: GraphNode | null;
  networkDrugs: DrugEntry[];
  networkData: Map<string, DrugNetworkData>;
  onClose: () => void;
}) {
  if (!node) return null;
  const ns = NODE_STYLES[node.nodeType];

  // For drug_main or drug_int: find interactions with other selected drugs
  const drugInteractions = useMemo(() => {
    if (node.nodeType !== "drug_main" && node.nodeType !== "drug_int") return [];
    const results: { partnerName: string; partnerId: string; severity: string; description: string }[] = [];
    for (const drug of networkDrugs) {
      const data = networkData.get(drug.id);
      if (!data) continue;
      for (const ix of data.interactions) {
        if (ix.drug_id === node.nodeId) {
          results.push({ partnerName: drug.name, partnerId: drug.id, severity: ix.severity, description: ix.description });
        }
      }
      if (drug.id === node.nodeId) {
        for (const ix of data.interactions) {
          if (networkDrugs.find(d => d.id === ix.drug_id)) {
            results.push({ partnerName: ix.name, partnerId: ix.drug_id, severity: ix.severity, description: ix.description });
          }
        }
      }
    }
    // Deduplicate
    const seen = new Set<string>();
    return results.filter(r => { const k = `${r.partnerId}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }, [node, networkDrugs, networkData]);

  // For protein: find which drugs connect to it
  const connectedDrugs = useMemo(() => {
    if (!["target", "enzyme", "transporter", "carrier"].includes(node.nodeType)) return [];
    const results: { drugName: string; drugId: string; actions: string[] }[] = [];
    for (const drug of networkDrugs) {
      const data = networkData.get(drug.id);
      if (!data) continue;
      const p = data.proteins.find(p => p.uniprot_id === node.nodeId);
      if (p) results.push({ drugName: drug.name, drugId: drug.id, actions: p.actions });
    }
    return results;
  }, [node, networkDrugs, networkData]);

  // For gene: find proteins
  const geneProteins = useMemo(() => {
    if (node.nodeType !== "gene") return [];
    const seen = new Set<string>();
    const results: { name: string; uniprot: string; type: string }[] = [];
    for (const data of networkData.values()) {
      for (const p of data.proteins) {
        if (p.gene_name === node.nodeId && !seen.has(p.uniprot_id)) {
          seen.add(p.uniprot_id);
          results.push({ name: p.name, uniprot: p.uniprot_id, type: p.type });
        }
      }
    }
    return results;
  }, [node, networkData]);

  return (
    <div
      className="absolute top-0 right-0 h-full flex flex-col"
      style={{ width: "300px", background: "#0b1628dd", backdropFilter: "blur(12px)", borderLeft: "1px solid #1e3a5f", zIndex: 10 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: "#1e3a5f" }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: ns.color + "30", color: ns.color }}>{ns.label}</span>
        </div>
        <button onClick={onClose} className="hover:text-white transition-colors" style={{ color: "#475569" }}><X size={14} /></button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Name + ID */}
        <div>
          <div className="font-bold text-base leading-snug" style={{ color: ns.color }}>{node.label}</div>
          {node.subLabel && <div className="text-xs font-mono mt-0.5" style={{ color: "#64748b" }}>{node.subLabel}</div>}
          {node.nodeType === "drug_main" && node.groups && node.groups.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {node.groups.slice(0, 4).map(g => (
                <span key={g} className="text-[10px] px-1.5 py-0.5 rounded-full capitalize" style={{ background: "#1e3a5f", color: "#94a3b8" }}>{g}</span>
              ))}
            </div>
          )}
        </div>

        {/* Drug: description + mechanism */}
        {(node.nodeType === "drug_main") && (
          <>
            {node.description && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#475569" }}>Description</div>
                <p className="text-[11px] leading-relaxed" style={{ color: "#94a3b8" }}>{node.description}</p>
              </div>
            )}
            {node.mechanism && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#475569" }}>Mechanism of Action</div>
                <p className="text-[11px] leading-relaxed" style={{ color: "#94a3b8" }}>{node.mechanism}</p>
              </div>
            )}
          </>
        )}

        {/* Drug interactions with selected drugs */}
        {(node.nodeType === "drug_main") && drugInteractions.length > 0 && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "#475569" }}>
              Interactions with Selected Drugs
            </div>
            <div className="space-y-2">
              {drugInteractions.map((ix, i) => {
                const sv = SEV_STYLE[normSev(ix.severity)];
                return (
                  <div key={i} className="rounded-lg p-2.5" style={{ background: sv.bg, border: `1px solid ${sv.border}` }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-bold" style={{ color: sv.text }}>{sv.icon} {ix.partnerName}</span>
                      <span className="text-[10px] font-bold" style={{ color: sv.text }}>{SEV_STYLE[normSev(ix.severity)].label}</span>
                    </div>
                    {ix.description && <p className="text-[10px] leading-relaxed line-clamp-3" style={{ color: "#94a3b8" }}>{ix.description}</p>}
                    <div className="mt-1.5 text-[10px] leading-relaxed" style={{ color: sv.text + "cc" }}>
                      → {RECOMMENDATIONS[normSev(ix.severity)]}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Drug_int: severity + description */}
        {node.nodeType === "drug_int" && (
          <>
            {node.severity && (
              <div className="rounded-lg p-2.5" style={{ background: SEV_STYLE[normSev(node.severity)].bg, border: `1px solid ${SEV_STYLE[normSev(node.severity)].border}` }}>
                <div className="flex items-center gap-1.5 mb-1">
                  {normSev(node.severity) === "major" && <AlertTriangle size={13} color={SEV_STYLE.major.text} />}
                  {normSev(node.severity) === "moderate" && <AlertCircle size={13} color={SEV_STYLE.moderate.text} />}
                  {normSev(node.severity) === "minor" && <CheckCircle2 size={13} color={SEV_STYLE.minor.text} />}
                  <span className="text-sm font-bold" style={{ color: SEV_STYLE[normSev(node.severity)].text }}>
                    {SEV_STYLE[normSev(node.severity)].label}
                  </span>
                </div>
                {node.description && <p className="text-[11px] leading-relaxed mt-1" style={{ color: "#94a3b8" }}>{node.description}</p>}
                <div className="mt-2 flex items-start gap-1.5 p-1.5 rounded" style={{ background: "#0f172a" }}>
                  <Info size={11} style={{ color: "#60a5fa", marginTop: 1 }} />
                  <p className="text-[10px] leading-relaxed" style={{ color: "#60a5fa" }}>{RECOMMENDATIONS[normSev(node.severity)]}</p>
                </div>
              </div>
            )}
          </>
        )}

        {/* Protein/Enzyme/Transporter/Carrier */}
        {["target", "enzyme", "transporter", "carrier"].includes(node.nodeType) && (
          <>
            {node.subLabel && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#475569" }}>Gene</div>
                <div className="text-xs font-mono font-bold" style={{ color: "#60a5fa" }}>{node.subLabel}</div>
              </div>
            )}
            {node.nodeId && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#475569" }}>UniProt ID</div>
                <div className="text-xs font-mono" style={{ color: "#94a3b8" }}>{node.nodeId}</div>
              </div>
            )}
            {node.actions && node.actions.length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#475569" }}>Actions</div>
                <div className="flex flex-wrap gap-1">
                  {node.actions.map(a => (
                    <span key={a} className="text-[10px] px-2 py-0.5 rounded-full capitalize" style={{ background: ns.color + "22", color: ns.color, border: `1px solid ${ns.color}44` }}>{a}</span>
                  ))}
                </div>
              </div>
            )}
            {connectedDrugs.length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#475569" }}>Connected Drugs</div>
                <div className="space-y-1">
                  {connectedDrugs.map(cd => (
                    <div key={cd.drugId} className="flex items-center justify-between px-2 py-1.5 rounded-lg" style={{ background: "#0f172a" }}>
                      <span className="text-[11px] font-medium" style={{ color: "#e2e8f0" }}>{cd.drugName}</span>
                      <div className="flex gap-1">
                        {cd.actions.slice(0, 2).map(a => (
                          <span key={a} className="text-[9px] px-1 py-0.5 rounded capitalize" style={{ background: "#1e3a5f", color: "#94a3b8" }}>{a}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Gene */}
        {node.nodeType === "gene" && geneProteins.length > 0 && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#475569" }}>Expressed Proteins</div>
            <div className="space-y-1">
              {geneProteins.map(p => (
                <div key={p.uniprot} className="flex items-center justify-between px-2 py-1.5 rounded-lg" style={{ background: "#0f172a" }}>
                  <span className="text-[11px] font-medium truncate flex-1" style={{ color: "#e2e8f0" }}>{p.name}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded ml-1 capitalize" style={{ background: NODE_STYLES[p.type as NodeType]?.color + "22" || "#1e3a5f", color: NODE_STYLES[p.type as NodeType]?.color || "#94a3b8" }}>{p.type}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* View full profile link for drugs */}
        {(node.nodeType === "drug_main" || node.nodeType === "drug_int") && (
          <Link
            to={`/drugs/${node.nodeId}`}
            className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all"
            style={{ background: "#1e3a5f", color: "#60a5fa" }}>
            <ExternalLink size={12} /> View Full Drug Profile
          </Link>
        )}
      </div>
    </div>
  );
}

/* ────────────────── MAIN PAGE ────────────────── */
export default function InteractionsPage() {
  const [categories, setCategories] = useState<DrugCategory[]>([]);
  const [catLoading, setCatLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [catDrugsFromApi, setCatDrugsFromApi] = useState<DrugEntry[]>([]);
  const [catDrugsLoading, setCatDrugsLoading] = useState(false);
  const [localDrugs, setLocalDrugs] = useState<{ id: string; name: string }[]>([]);

  const [networkDrugs, setNetworkDrugs] = useState<DrugEntry[]>([]);
  const [networkSearch, setNetworkSearch] = useState("");
  const [networkSuggestions, setNetworkSuggestions] = useState<DrugEntry[]>([]);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkData, setNetworkData] = useState<Map<string, DrugNetworkData>>(new Map());
  const [activeFilters, setActiveFilters] = useState<Set<NodeType>>(
    new Set(["target", "gene", "drug_int", "enzyme", "transporter", "carrier"] as NodeType[])
  );
  const [maxNodes, setMaxNodes] = useState(80);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [physicsEnabled, setPhysicsEnabled] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const [graphDimensions, setGraphDimensions] = useState({ width: 800, height: 640 });

  /* ── Load categories ── */
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/drug_categories.json`)
      .then(r => r.json())
      .then((data: DrugCategory[]) => { setCategories(data); setCatLoading(false); });
  }, []);

  /* ── Load category drugs ── */
  useEffect(() => {
    if (!activeCategory) { setCatDrugsFromApi([]); return; }
    let cancelled = false;
    setCatDrugsLoading(true);
    apiFetchDrugsByCategory(activeCategory, 300).then(drugs => {
      if (!cancelled) {
        setCatDrugsFromApi(drugs.length > 0 ? drugs : (categories.find(c => c.key === activeCategory)?.drugs ?? []));
        setCatDrugsLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [activeCategory, categories]);

  /* ── Local drugs fallback ── */
  useEffect(() => {
    getDrugs().then(drugs => { if (drugs.length > 0) setLocalDrugs(drugs.map(d => ({ id: d.id, name: d.name }))); });
    fetch(`${import.meta.env.BASE_URL}data/drugs.json`).then(r => r.json())
      .then((data: { id: string; name: string }[]) => { setLocalDrugs(prev => prev.length > 0 ? prev : data.map(d => ({ id: d.id, name: d.name }))); })
      .catch(() => {});
  }, []);

  /* ── Resize observer ── */
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const e = entries[0];
      if (e) setGraphDimensions({ width: e.contentRect.width, height: Math.max(640, e.contentRect.height) });
    });
    if (graphContainerRef.current) obs.observe(graphContainerRef.current);
    return () => obs.disconnect();
  }, []);

  /* ── Search autocomplete ── */
  useEffect(() => {
    if (networkSearch.length < 2) { setNetworkSuggestions([]); return; }
    const ctrl = new AbortController();
    const q = networkSearch.toLowerCase();
    apiSearchDrugs(networkSearch, ctrl.signal)
      .then(r => setNetworkSuggestions((r.length > 0 ? r : localDrugs.filter(d => d.name.toLowerCase().includes(q))).filter(d => !networkDrugs.find(s => s.id === d.id)).slice(0, 8)))
      .catch(() => setNetworkSuggestions(localDrugs.filter(d => d.name.toLowerCase().includes(q) && !networkDrugs.find(s => s.id === d.id)).slice(0, 8)));
    return () => ctrl.abort();
  }, [networkSearch, networkDrugs, localDrugs]);

  /* ── Build graph data ──
     Priority order:
     1. Always include all drug_main nodes
     2. Add drug-drug interaction LINKS between selected drugs (no extra nodes)
     3. Fill proteins up to maxNodes budget (proportional per drug)
     4. Fill remaining budget with drug_int nodes (external drugs)
  */
  const graphData = useMemo(() => {
    if (networkDrugs.length === 0 || networkData.size === 0)
      return { nodes: [] as GraphNode[], links: [] as GraphLink[] };

    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const nodeIds = new Set<string>();
    const add = (n: GraphNode) => { if (!nodeIds.has(n.id as string)) { nodeIds.add(n.id as string); nodes.push(n); } };

    // Step 1: All drug_main nodes always included
    for (const drug of networkDrugs) {
      const data = networkData.get(drug.id);
      add({
        id: `drug_${drug.id}`, nodeId: drug.id, label: drug.name, subLabel: drug.id,
        nodeType: "drug_main",
        description: data?.drug.description, mechanism: data?.drug.mechanism, groups: data?.drug.groups,
      });
    }

    // Step 2: Drug-drug links between selected drugs (direct edges, no extra nodes)
    const seenDrugPairs = new Set<string>();
    for (const drug of networkDrugs) {
      const data = networkData.get(drug.id);
      if (!data) continue;
      for (const ix of data.interactions) {
        const partner = networkDrugs.find(d => d.id === ix.drug_id);
        if (!partner) continue;
        const pairKey = [drug.id, ix.drug_id].sort().join(":");
        if (seenDrugPairs.has(pairKey)) continue;
        seenDrugPairs.add(pairKey);
        links.push({ source: `drug_${drug.id}`, target: `drug_${ix.drug_id}`, severity: ix.severity, linkLabel: `${normSev(ix.severity)} risk` });
      }
    }

    // Step 3: Proteins — budget = maxNodes minus drug_main count, split evenly per drug
    const proteinBudgetTotal = Math.max(4, maxNodes - networkDrugs.length);
    const perDrugBudget = Math.ceil(proteinBudgetTotal / networkDrugs.length);

    for (const drug of networkDrugs) {
      const data = networkData.get(drug.id);
      if (!data) continue;
      let addedForDrug = 0;
      for (const p of data.proteins) {
        if (addedForDrug >= perDrugBudget) break;
        const nt = p.type as NodeType;
        if (!activeFilters.has(nt)) continue;
        const nid = `protein_${p.uniprot_id}`;
        if (!nodeIds.has(nid)) {
          add({ id: nid, nodeId: p.uniprot_id, label: p.name, subLabel: p.gene_name, nodeType: nt, actions: p.actions });
          addedForDrug++;
        }
        links.push({ source: `drug_${drug.id}`, target: nid, linkLabel: p.actions[0] ?? p.type });
        // Gene sub-nodes
        if (p.gene_name && activeFilters.has("gene")) {
          const gid = `gene_${p.gene_name}`;
          if (!nodeIds.has(gid)) add({ id: gid, nodeId: p.gene_name, label: p.gene_name, nodeType: "gene" });
          links.push({ source: nid, target: gid, linkLabel: "expressed" });
        }
      }
    }

    // Step 4: External drug_int nodes with remaining budget
    if (activeFilters.has("drug_int")) {
      const remaining = maxNodes - nodes.length;
      if (remaining > 0) {
        const intPerDrug = Math.ceil(remaining / networkDrugs.length);
        for (const drug of networkDrugs) {
          const data = networkData.get(drug.id);
          if (!data) continue;
          let cnt = 0;
          for (const ix of data.interactions) {
            if (cnt >= intPerDrug) break;
            if (networkDrugs.find(d => d.id === ix.drug_id)) continue; // skip already-selected drugs
            const did = `drug_${ix.drug_id}`;
            if (!nodeIds.has(did) && nodes.length < maxNodes) {
              add({ id: did, nodeId: ix.drug_id, label: ix.name, subLabel: ix.drug_id, nodeType: "drug_int", description: ix.description, severity: ix.severity });
              cnt++;
            }
            if (nodeIds.has(did)) {
              links.push({ source: `drug_${drug.id}`, target: did, severity: ix.severity, linkLabel: `${normSev(ix.severity)} risk` });
            }
          }
        }
      }
    }

    const validIds = new Set(nodes.map(n => n.id as string));
    return { nodes, links: links.filter(l => validIds.has(l.source as string) && validIds.has(l.target as string)) };
  }, [networkData, networkDrugs, activeFilters, maxNodes]);

  const networkStats = useMemo(() => {
    const c = { drugs: 0, targets: 0, enzymes: 0, transporters: 0, carriers: 0, drug_interactions: 0, genes: 0 };
    for (const n of graphData.nodes) {
      if (n.nodeType === "drug_main") c.drugs++;
      if (n.nodeType === "target") c.targets++;
      if (n.nodeType === "enzyme") c.enzymes++;
      if (n.nodeType === "transporter") c.transporters++;
      if (n.nodeType === "carrier") c.carriers++;
      if (n.nodeType === "drug_int") c.drug_interactions++;
      if (n.nodeType === "gene") c.genes++;
    }
    return c;
  }, [graphData.nodes]);

  /* ── Callbacks ── */
  const addNetworkDrug = useCallback((drug: DrugEntry) => {
    if (networkDrugs.length >= 6 || networkDrugs.find(d => d.id === drug.id)) return;
    setNetworkDrugs(prev => [...prev, drug]); setNetworkSearch(""); setNetworkSuggestions([]);
  }, [networkDrugs]);

  const removeNetworkDrug = useCallback((id: string) => {
    setNetworkDrugs(prev => prev.filter(d => d.id !== id));
    setNetworkData(prev => { const m = new Map(prev); m.delete(id); return m; });
  }, []);

  const visualizeNetwork = useCallback(async () => {
    if (networkDrugs.length === 0) return;
    setNetworkLoading(true); setSelectedNode(null);
    const results = await Promise.all(networkDrugs.map(d => apiFetchDrugNetwork(d.id, Math.max(150, maxNodes))));
    const newData = new Map<string, DrugNetworkData>();
    networkDrugs.forEach((d, i) => { if (results[i]) newData.set(d.id, results[i]!); });
    setNetworkData(newData); setNetworkLoading(false);
    setTimeout(() => graphRef.current?.zoomToFit(600, 40), 800);
  }, [networkDrugs, maxNodes]);

  const toggleFilter = useCallback((type: NodeType) => {
    setActiveFilters(prev => { const next = new Set(prev); if (next.has(type)) next.delete(type); else next.add(type); return next; });
  }, []);

  /* ── Canvas renderers ── */
  const nodeCanvasObject = useCallback((rawNode: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const node = rawNode as GraphNode;
    const style = NODE_STYLES[node.nodeType];
    const x = node.x ?? 0, y = node.y ?? 0;
    const r = style.size * (node.nodeType === "drug_main" ? 1.2 : 1);
    const isSelected = selectedNode?.id === node.id;
    drawNodeShape(ctx, x, y, r, style.shape, style.color, isSelected);
    if (globalScale > 0.8 || node.nodeType === "drug_main") {
      const maxLen = node.nodeType === "drug_main" ? 15 : 11;
      const lbl = node.label.length > maxLen ? node.label.substring(0, maxLen - 1) + "…" : node.label;
      const fontSize = Math.max(3.5, node.nodeType === "drug_main" ? 9 / globalScale : 7 / globalScale);
      ctx.font = `${node.nodeType === "drug_main" ? "bold " : ""}${fontSize}px sans-serif`;
      ctx.textAlign = "center"; ctx.fillStyle = "#ffffff"; ctx.shadowColor = "#00000088"; ctx.shadowBlur = 4;
      ctx.fillText(lbl, x, y + r + fontSize + 1.5); ctx.shadowBlur = 0;
    }
  }, [selectedNode]);

  const linkColor = useCallback((rawLink: LinkObject) => {
    const link = rawLink as GraphLink;
    if (link.severity === "major") return "#ef444499";
    if (link.severity === "moderate") return "#f59e0b88";
    return "#ffffff1a";
  }, []);

  const cc = (col: string) => CAT_COLORS[col] ?? CAT_COLORS.blue;
  const activeCat = categories.find(c => c.key === activeCategory);
  const catDrugsFiltered = catDrugsFromApi.length > 0 ? catDrugsFromApi : (activeCat?.drugs ?? []);

  /* ────────────────── RENDER ────────────────── */
  return (
    <div className="min-h-screen" style={{ background: "#070e1a" }}>
      {/* PAGE HEADER */}
      <div className="bg-gradient-to-r from-primary-950 via-primary-900 to-primary-800 text-white pt-8 pb-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center gap-2 text-blue-300 text-sm mb-4">
            <Link to="/" className="hover:text-white transition-colors">Home</Link>
            <ChevronRight size={14} />
            <span className="text-white font-medium">Drug Interaction Network</span>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center">
                  <Zap size={22} className="text-amber-300" />
                </div>
                <h1 className="text-3xl font-extrabold tracking-tight">Drug Interaction Network</h1>
              </div>
              <p className="text-blue-300 text-sm mt-1 pl-1">
                Molecular network visualization · 24,386 interaction pairs · Select drugs by disease category
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-emerald-300 bg-emerald-900/30 border border-emerald-700/40 px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              DrugBank · 2026
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "NETWORK DRUGS",   val: networkStats.drugs,         cls: "from-blue-900/60   to-blue-800/40   border-blue-700/40"   },
              { label: "TOTAL NODES",     val: graphData.nodes.length,     cls: "from-violet-900/60 to-violet-800/40 border-violet-700/40" },
              { label: "CONNECTIONS",     val: graphData.links.length,     cls: "from-amber-900/60  to-amber-800/40  border-amber-700/40"  },
              { label: "PROTEIN TARGETS", val: networkStats.targets,       cls: "from-red-900/60    to-red-800/40    border-red-700/40"    },
            ].map(s => (
              <div key={s.label} className={`rounded-2xl border p-4 bg-gradient-to-br ${s.cls}`}>
                <div className="text-[10px] font-bold text-gray-400 tracking-widest mb-1">{s.label}</div>
                <span className="text-4xl font-extrabold text-white">{s.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="rounded-3xl overflow-hidden" style={{ background: "#0b1628", border: "1px solid #1e3a5f" }}>

          {/* ── Top bar ── */}
          <div className="px-5 py-3 border-b flex items-center justify-between flex-wrap gap-2" style={{ borderColor: "#1e3a5f" }}>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#1e3a5f" }}>
                <Zap size={14} className="text-blue-400" />
              </div>
              <span className="text-white font-bold text-sm">Molecular Network Map</span>
              <span className="text-xs" style={{ color: "#475569" }}>· click any node for details</span>
            </div>
            {networkData.size > 0 && (
              <div className="flex items-center gap-2">
                <button onClick={() => graphRef.current?.zoomToFit(400, 40)} className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5" style={{ background: "#1e3a5f", color: "#94a3b8" }}>
                  <RefreshCw size={11} /> Reset View
                </button>
                <button onClick={() => setPhysicsEnabled(p => !p)} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: physicsEnabled ? "#1d4ed833" : "#1e3a5f", color: physicsEnabled ? "#60a5fa" : "#94a3b8", border: physicsEnabled ? "1px solid #1d4ed8" : "1px solid transparent" }}>
                  Physics {physicsEnabled ? "ON" : "OFF"}
                </button>
                <button onClick={() => { const c = graphContainerRef.current?.querySelector("canvas"); if (!c) return; const a = document.createElement("a"); a.download = "network.png"; a.href = (c as HTMLCanvasElement).toDataURL(); a.click(); }} className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5" style={{ background: "#1e3a5f", color: "#94a3b8" }}>
                  <Maximize2 size={11} /> Export
                </button>
              </div>
            )}
          </div>

          {/* ── FILTER BAR (above graph) ── */}
          <div className="px-5 py-3 border-b flex items-center gap-3 flex-wrap" style={{ borderColor: "#1e3a5f", background: "#090f1e" }}>
            <span className="text-[10px] font-bold uppercase tracking-wider shrink-0" style={{ color: "#475569" }}>Display Filter</span>
            <div className="flex flex-wrap gap-2">
              {FILTER_TYPES.map(({ key, label }) => {
                const active = activeFilters.has(key);
                const ns = NODE_STYLES[key];
                return (
                  <button
                    key={key}
                    onClick={() => toggleFilter(key)}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
                    style={{
                      background: active ? ns.color : "#0f172a",
                      color: active ? "#ffffff" : "#475569",
                      border: `1.5px solid ${active ? ns.color : "#1e3a5f"}`,
                    }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: active ? "#ffffff88" : ns.color }} />
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[10px]" style={{ color: "#475569" }}>Max Nodes:</span>
              <input type="range" min={10} max={300} value={maxNodes} onChange={e => setMaxNodes(Number(e.target.value))} className="w-24 accent-blue-500" />
              <span className="text-xs font-bold w-6 text-right" style={{ color: "#60a5fa" }}>{maxNodes}</span>
            </div>
          </div>

          <div className="flex" style={{ minHeight: "680px" }}>

            {/* ══ LEFT PANEL ══ */}
            <div className="w-72 shrink-0 border-r flex flex-col" style={{ borderColor: "#1e3a5f", overflowY: "auto", maxHeight: "680px" }}>

              {/* Selected drugs */}
              <div className="p-4 border-b" style={{ borderColor: "#1e3a5f" }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold" style={{ color: "#64748b" }}>SELECTED DRUGS ({networkDrugs.length}/6)</span>
                  {networkDrugs.length > 0 && (
                    <button onClick={() => { setNetworkDrugs([]); setNetworkData(new Map()); setSelectedNode(null); }} className="text-[10px] hover:text-red-400 transition-colors" style={{ color: "#475569" }}>Clear all</button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 min-h-[28px] mb-3">
                  {networkDrugs.length === 0
                    ? <p className="text-[11px]" style={{ color: "#334155" }}>Browse categories below to add drugs.</p>
                    : networkDrugs.map(d => (
                        <div key={d.id} className="flex items-center gap-1 rounded-full px-2.5 py-1" style={{ background: "#1e3a5f" }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#1d4ed8" }} />
                          <span className="text-xs font-medium truncate max-w-[90px]" style={{ color: "#e2e8f0" }}>{d.name}</span>
                          <button onClick={() => removeNetworkDrug(d.id)} className="ml-0.5 hover:text-red-400" style={{ color: "#475569" }}><X size={9} /></button>
                        </div>
                      ))
                  }
                </div>
                <button onClick={visualizeNetwork} disabled={networkDrugs.length === 0 || networkLoading}
                  className="w-full py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2 transition-all hover:brightness-110"
                  style={{ background: "#1d4ed8", color: "#ffffff" }}>
                  {networkLoading ? <><Loader2 size={14} className="animate-spin" /> Loading...</> : <><Zap size={14} /> Visualize Network</>}
                </button>
              </div>

              {/* Search */}
              <div className="px-4 pt-3 pb-2">
                <div className="text-[10px] font-bold mb-2 uppercase tracking-wider" style={{ color: "#64748b" }}>Search Drug</div>
                <div className="relative">
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2 border" style={{ background: "#0f172a", borderColor: "#1e3a5f" }}>
                    <Search size={11} style={{ color: "#475569" }} />
                    <input type="text" value={networkSearch} onChange={e => setNetworkSearch(e.target.value)}
                      placeholder="Drug name or ID..." className="flex-1 text-xs bg-transparent outline-none" style={{ color: "#e2e8f0" }}
                      onKeyDown={e => { if (e.key === "Enter" && networkSuggestions.length > 0) { e.preventDefault(); addNetworkDrug(networkSuggestions[0]); } }} />
                    {networkSearch && <button onClick={() => { setNetworkSearch(""); setNetworkSuggestions([]); }} style={{ color: "#475569" }}><X size={10} /></button>}
                  </div>
                  {networkSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden shadow-2xl z-30" style={{ background: "#0f172a", border: "1px solid #1e3a5f" }}>
                      {networkSuggestions.map(d => (
                        <button key={d.id} onClick={() => addNetworkDrug(d)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors">
                          <Plus size={10} style={{ color: "#60a5fa" }} />
                          <span className="text-xs font-medium truncate flex-1" style={{ color: "#e2e8f0" }}>{d.name}</span>
                          <span className="text-[10px] font-mono" style={{ color: "#475569" }}>{d.id}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Disease category chips */}
              <div className="px-4 pt-1 pb-2">
                <div className="text-[10px] font-bold mb-2 uppercase tracking-wider" style={{ color: "#64748b" }}>Disease Categories</div>
                {catLoading
                  ? <div className="flex items-center gap-1.5 text-xs py-2" style={{ color: "#475569" }}><Loader2 size={11} className="animate-spin" /> Loading...</div>
                  : (
                    <div className="flex flex-wrap gap-1.5">
                      {categories.map(cat => {
                        const isActive = activeCategory === cat.key;
                        const cols = cc(cat.color);
                        return (
                          <button key={cat.key} onClick={() => setActiveCategory(isActive ? null : cat.key)}
                            className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-all ring-1 ${isActive ? `${cols.bg} ${cols.tx} ${cols.rg}` : "ring-transparent"}`}
                            style={isActive ? {} : { background: "#0f172a", color: "#64748b" }}>
                            <span>{cat.icon}</span>
                            <span>{cat.label}</span>
                            <span className="text-[9px] opacity-60">{isActive && catDrugsFromApi.length > 0 ? catDrugsFromApi.length : cat.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
              </div>

              {/* Drug list from category */}
              {activeCategory && (
                <div className="px-4 pb-3 border-b" style={{ borderColor: "#1e3a5f" }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#475569" }}>
                      {activeCat?.icon} {activeCat?.label}
                    </div>
                    <span className="text-[10px]" style={{ color: "#334155" }}>{catDrugsFiltered.length}</span>
                  </div>
                  {catDrugsLoading
                    ? <div className="flex items-center gap-1.5 py-4 justify-center text-xs" style={{ color: "#475569" }}><Loader2 size={12} className="animate-spin" /> Loading...</div>
                    : (
                      <div className="space-y-0.5 max-h-56 overflow-y-auto pr-1">
                        {catDrugsFiltered.map(drug => {
                          const isSel = !!networkDrugs.find(s => s.id === drug.id);
                          const disabled = !isSel && networkDrugs.length >= 6;
                          return (
                            <button key={drug.id}
                              onClick={() => isSel ? removeNetworkDrug(drug.id) : addNetworkDrug(drug)}
                              disabled={disabled}
                              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-all disabled:opacity-30"
                              style={{ background: isSel ? "#1e3a5f" : "transparent", color: isSel ? "#93c5fd" : "#94a3b8" }}
                              onMouseEnter={e => { if (!isSel && !disabled) (e.currentTarget as HTMLButtonElement).style.background = "#0f172a"; }}
                              onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
                              <span className="truncate flex-1 text-left font-medium">{drug.name}</span>
                              <div className="flex items-center gap-1 shrink-0 ml-1">
                                <span className="font-mono text-[9px]" style={{ color: "#334155" }}>{drug.id}</span>
                                {isSel ? <X size={9} style={{ color: "#60a5fa" }} /> : <Plus size={9} style={{ color: "#334155" }} />}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                </div>
              )}

              {/* Stats summary in left panel */}
              {networkData.size > 0 && (
                <div className="p-4">
                  <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "#64748b" }}>Network Summary</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { label: "Targets",      val: networkStats.targets,          color: "#ef4444" },
                      { label: "Genes",        val: networkStats.genes,            color: "#a855f7" },
                      { label: "Drug Int.",    val: networkStats.drug_interactions, color: "#f97316" },
                      { label: "Enzymes",      val: networkStats.enzymes,          color: "#06b6d4" },
                      { label: "Transporters", val: networkStats.transporters,     color: "#22c55e" },
                      { label: "Carriers",     val: networkStats.carriers,         color: "#f59e0b" },
                    ].map(s => (
                      <div key={s.label} className="rounded-lg px-2 py-1.5 text-center" style={{ background: s.color + "18", border: `1px solid ${s.color}30` }}>
                        <div className="text-base font-extrabold" style={{ color: s.color }}>{s.val}</div>
                        <div className="text-[9px] font-bold" style={{ color: "#475569" }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ══ GRAPH CANVAS + NODE DETAIL ══ */}
            <div className="flex-1 relative overflow-hidden">
              <div ref={graphContainerRef} className="w-full" style={{ height: "680px" }}>
                {networkData.size > 0 ? (
                  <ForceGraph2D
                    ref={graphRef}
                    graphData={graphData}
                    width={graphDimensions.width - (selectedNode ? 300 : 0)}
                    height={graphDimensions.height}
                    backgroundColor="#0b1628"
                    nodeCanvasObject={nodeCanvasObject}
                    nodePointerAreaPaint={(rawNode, color, ctx) => {
                      const node = rawNode as GraphNode;
                      const r = NODE_STYLES[node.nodeType].size * 1.8;
                      ctx.fillStyle = color; ctx.beginPath();
                      ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, Math.PI * 2); ctx.fill();
                    }}
                    linkColor={linkColor}
                    linkWidth={(l) => { const lk = l as GraphLink; return lk.severity === "major" ? 2.5 : lk.severity === "moderate" ? 1.8 : 1; }}
                    linkDirectionalArrowLength={4}
                    linkDirectionalArrowRelPos={1}
                    linkLabel={(rawLink) => (rawLink as GraphLink).linkLabel ?? ""}
                    onNodeClick={(rawNode) => {
                      const n = rawNode as GraphNode;
                      setSelectedNode(prev => prev?.id === n.id ? null : n);
                    }}
                    cooldownTicks={physicsEnabled ? 300 : 0}
                    d3AlphaDecay={0.02}
                    d3VelocityDecay={0.3}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center">
                    <div className="text-center space-y-4">
                      <div className="w-24 h-24 rounded-full flex items-center justify-center mx-auto" style={{ border: "2px dashed #1e3a5f" }}>
                        <Zap size={36} style={{ color: "#1e3a5f" }} />
                      </div>
                      <p className="font-bold text-lg" style={{ color: "#334155" }}>No Network Loaded</p>
                      <p className="text-sm max-w-xs" style={{ color: "#1e3a5f" }}>
                        ← Select a disease category, pick drugs, then click <strong style={{ color: "#3b82f6" }}>Visualize Network</strong>
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Legend overlay */}
              {networkData.size > 0 && (
                <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 px-3 py-2 rounded-xl" style={{ background: "#0b162299", backdropFilter: "blur(8px)", border: "1px solid #1e3a5f44" }}>
                  {(Object.entries(NODE_STYLES) as [NodeType, typeof NODE_STYLES[NodeType]][]).map(([type, ns]) => (
                    <div key={type} className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: ns.color }} />
                      <span className="text-[10px]" style={{ color: "#64748b" }}>{ns.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Node detail panel (floating right) */}
              {selectedNode && (
                <NodeDetailPanel
                  node={selectedNode}
                  networkDrugs={networkDrugs}
                  networkData={networkData}
                  onClose={() => setSelectedNode(null)}
                />
              )}
            </div>
          </div>

          {/* Mechanism of action footer */}
          {networkData.size > 0 && Array.from(networkData.values()).some(d => d.drug.mechanism) && (
            <div className="px-5 py-4 border-t" style={{ borderColor: "#1e3a5f" }}>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "#64748b" }}>Mechanism of Action</div>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {networkDrugs.map(drug => {
                  const data = networkData.get(drug.id);
                  if (!data?.drug.mechanism) return null;
                  return (
                    <div key={drug.id} className="rounded-xl p-3" style={{ background: "#0f172a", border: "1px solid #1e3a5f" }}>
                      <div className="text-xs font-bold mb-1" style={{ color: "#60a5fa" }}>{drug.name}</div>
                      <p className="text-[11px] leading-relaxed line-clamp-3" style={{ color: "#64748b" }}>{data.drug.mechanism}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
