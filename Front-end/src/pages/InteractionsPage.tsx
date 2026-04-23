import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import ForceGraph2D, { type NodeObject, type LinkObject } from "react-force-graph-2d";
import {
  Zap, Search, X, ChevronRight, Plus, Loader2, RefreshCw, Maximize2,
  ExternalLink, AlertTriangle, AlertCircle, CheckCircle2, Info, Network,
} from "lucide-react";
import { getDrugs } from "../lib/drugCache";
import { apiSearchDrugs, apiFetchDrugsByCategory, apiFetchDrugNetwork } from "../lib/api";
import type { DrugNetworkData } from "../lib/api";

/* ─────────── TYPES ─────────── */
interface DrugEntry { id: string; name: string; targetCount?: number; enzymeCount?: number; }
interface DrugCategory { key: string; label: string; icon: string; color: string; count: number; drugs: DrugEntry[]; }
type NodeType = "drug_main" | "drug_int" | "target" | "enzyme" | "transporter" | "carrier" | "gene";

interface GraphNode extends NodeObject {
  nodeId: string; label: string; subLabel?: string; nodeType: NodeType;
  description?: string; mechanism?: string; actions?: string[]; groups?: string[]; severity?: string;
}
interface GraphLink extends LinkObject { linkLabel?: string; severity?: string; }

/* ─────────── CONSTANTS ─────────── */
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
  drug_main:   { color: "#1d4ed8", size: 14, shape: "diamond",  label: "Main Drug"        },
  drug_int:    { color: "#f97316", size: 8,  shape: "circle",   label: "Interacting Drug" },
  target:      { color: "#ef4444", size: 8,  shape: "hexagon",  label: "Protein Target"   },
  enzyme:      { color: "#06b6d4", size: 7,  shape: "square",   label: "Enzyme"           },
  transporter: { color: "#22c55e", size: 7,  shape: "triangle", label: "Transporter"      },
  carrier:     { color: "#f59e0b", size: 6,  shape: "circle",   label: "Carrier"          },
  gene:        { color: "#a855f7", size: 6,  shape: "star",     label: "Gene/Genomics"    },
};

const FILTER_TYPES: { key: NodeType; label: string }[] = [
  { key: "target",      label: "Protein Target"   },
  { key: "gene",        label: "Gene/Genomics"     },
  { key: "drug_int",    label: "Drug Interactions" },
  { key: "enzyme",      label: "Enzyme"            },
  { key: "transporter", label: "Transporter"       },
  { key: "carrier",     label: "Carrier"           },
];

// Demo drugs with good protein data
const DEMO_DRUGS: DrugEntry[] = [
  { id: "DB01234", name: "Dexamethasone" },
  { id: "DB00641", name: "Simvastatin"   },
  { id: "DB00178", name: "Ramipril"      },
  { id: "DB00472", name: "Fluoxetine"    },
  { id: "DB00295", name: "Morphine"      },
  { id: "DB00993", name: "Azathioprine"  },
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

/* ─────────── DRAW HELPERS ─────────── */
function drawNodeShape(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number,
  shape: string, color: string, isSelected: boolean,
) {
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.strokeStyle = isSelected ? "#ffffff" : "#ffffff22";
  ctx.lineWidth = isSelected ? 2.5 : 1;
  switch (shape) {
    case "circle":
      ctx.arc(x, y, r, 0, Math.PI * 2);
      break;
    case "diamond":
      ctx.moveTo(x, y - r * 1.5); ctx.lineTo(x + r * 1.1, y);
      ctx.lineTo(x, y + r * 1.5); ctx.lineTo(x - r * 1.1, y); ctx.closePath();
      break;
    case "hexagon":
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        if (i === 0) ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
        else ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
      }
      ctx.closePath();
      break;
    case "triangle":
      ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r, y + r * 0.8);
      ctx.lineTo(x - r, y + r * 0.8); ctx.closePath();
      break;
    case "square": {
      const s = r * 1.05; ctx.rect(x - s, y - s, s * 2, s * 2); break;
    }
    case "star": {
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        const rad = i % 2 === 0 ? r : r * 0.45;
        if (i === 0) ctx.moveTo(x + rad * Math.cos(a), y + rad * Math.sin(a));
        else ctx.lineTo(x + rad * Math.cos(a), y + rad * Math.sin(a));
      }
      ctx.closePath(); break;
    }
  }
  ctx.fill(); ctx.stroke();
  if (isSelected) {
    ctx.beginPath(); ctx.arc(x, y, r * 2, 0, Math.PI * 2);
    ctx.strokeStyle = color + "55"; ctx.lineWidth = 1.5; ctx.stroke();
  }
}

/* ─────────── NODE DETAIL PANEL ─────────── */
function NodeDetailPanel({
  node, networkDrugs, networkData, onClose,
}: {
  node: GraphNode;
  networkDrugs: DrugEntry[];
  networkData: Map<string, DrugNetworkData>;
  onClose: () => void;
}) {
  const ns = NODE_STYLES[node.nodeType];

  const drugInteractions = useMemo(() => {
    if (node.nodeType !== "drug_main" && node.nodeType !== "drug_int") return [];
    const seen = new Set<string>(); const results: { partnerName: string; partnerId: string; severity: string; description: string }[] = [];
    for (const drug of networkDrugs) {
      const data = networkData.get(drug.id); if (!data) continue;
      for (const ix of data.interactions) {
        if (ix.drug_id === node.nodeId && !seen.has(drug.id)) {
          seen.add(drug.id);
          results.push({ partnerName: drug.name, partnerId: drug.id, severity: ix.severity, description: ix.description });
        }
      }
      if (drug.id === node.nodeId) {
        for (const ix of data.interactions) {
          if (!seen.has(ix.drug_id) && networkDrugs.find(d => d.id === ix.drug_id)) {
            seen.add(ix.drug_id);
            results.push({ partnerName: ix.name, partnerId: ix.drug_id, severity: ix.severity, description: ix.description });
          }
        }
      }
    }
    return results;
  }, [node, networkDrugs, networkData]);

  const connectedDrugs = useMemo(() => {
    if (!["target", "enzyme", "transporter", "carrier"].includes(node.nodeType)) return [];
    const results: { drugName: string; drugId: string; actions: string[] }[] = [];
    for (const drug of networkDrugs) {
      const data = networkData.get(drug.id); if (!data) continue;
      const p = data.proteins.find(p => p.uniprot_id === node.nodeId);
      if (p) results.push({ drugName: drug.name, drugId: drug.id, actions: p.actions });
    }
    return results;
  }, [node, networkDrugs, networkData]);

  const geneProteins = useMemo(() => {
    if (node.nodeType !== "gene") return [];
    const seen = new Set<string>(); const results: { name: string; uniprot: string; type: string }[] = [];
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

  const sev = node.severity ? normSev(node.severity) : null;

  return (
    <div
      className="absolute top-0 right-0 h-full flex flex-col"
      style={{ width: "300px", background: "#060d1aee", backdropFilter: "blur(16px)", borderLeft: "1px solid #1e3a5f", zIndex: 20 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: "#1e3a5f" }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-extrabold px-2 py-1 rounded-full tracking-wide uppercase" style={{ background: ns.color + "25", color: ns.color, border: `1px solid ${ns.color}50` }}>
            {ns.label}
          </span>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-full transition-colors" style={{ color: "#475569" }}
          onMouseEnter={e => (e.currentTarget.style.background = "#1e3a5f")} onMouseLeave={e => (e.currentTarget.style.background = "")}>
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-3 space-y-4">

          {/* Name */}
          <div>
            <div className="font-extrabold text-lg leading-tight" style={{ color: ns.color }}>{node.label}</div>
            {node.subLabel && <div className="text-xs font-mono mt-1" style={{ color: "#475569" }}>{node.subLabel}</div>}
            {node.nodeType === "drug_main" && node.groups && node.groups.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {node.groups.slice(0, 5).map(g => (
                  <span key={g} className="text-[10px] px-2 py-0.5 rounded-full capitalize" style={{ background: "#1e3a5f80", color: "#94a3b8", border: "1px solid #1e3a5f" }}>{g}</span>
                ))}
              </div>
            )}
          </div>

          {/* ── drug_main: description + mechanism ── */}
          {node.nodeType === "drug_main" && (
            <>
              {node.description && (
                <div>
                  <div className="text-[9px] font-extrabold uppercase tracking-widest mb-1.5" style={{ color: "#334155" }}>Description</div>
                  <p className="text-[11px] leading-relaxed" style={{ color: "#94a3b8" }}>{node.description}</p>
                </div>
              )}
              {node.mechanism && (
                <div>
                  <div className="text-[9px] font-extrabold uppercase tracking-widest mb-1.5" style={{ color: "#334155" }}>Mechanism of Action</div>
                  <p className="text-[11px] leading-relaxed" style={{ color: "#94a3b8" }}>{node.mechanism}</p>
                </div>
              )}
            </>
          )}

          {/* ── drug_main: interactions with other selected drugs ── */}
          {node.nodeType === "drug_main" && drugInteractions.length > 0 && (
            <div>
              <div className="text-[9px] font-extrabold uppercase tracking-widest mb-2" style={{ color: "#334155" }}>
                Interactions with Selected Drugs
              </div>
              <div className="space-y-2">
                {drugInteractions.map((ix, i) => {
                  const sv = SEV_STYLE[normSev(ix.severity)];
                  return (
                    <div key={i} className="rounded-xl p-3" style={{ background: sv.bg, border: `1px solid ${sv.border}` }}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-bold" style={{ color: sv.text }}>{sv.icon} {ix.partnerName}</span>
                        <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full" style={{ background: sv.border, color: sv.text }}>{SEV_STYLE[normSev(ix.severity)].label}</span>
                      </div>
                      {ix.description && <p className="text-[10px] leading-relaxed mb-2" style={{ color: "#94a3b8" }}>{ix.description}</p>}
                      <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg" style={{ background: "#0a0f1e" }}>
                        <Info size={10} style={{ color: sv.text, marginTop: 1, flexShrink: 0 }} />
                        <p className="text-[10px] leading-relaxed" style={{ color: sv.text + "bb" }}>{RECOMMENDATIONS[normSev(ix.severity)]}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── drug_int: severity panel ── */}
          {node.nodeType === "drug_int" && sev && (
            <div className="rounded-xl p-3" style={{ background: SEV_STYLE[sev].bg, border: `1px solid ${SEV_STYLE[sev].border}` }}>
              <div className="flex items-center gap-2 mb-2">
                {sev === "major" && <AlertTriangle size={15} color={SEV_STYLE.major.text} />}
                {sev === "moderate" && <AlertCircle size={15} color={SEV_STYLE.moderate.text} />}
                {sev === "minor" && <CheckCircle2 size={15} color={SEV_STYLE.minor.text} />}
                <span className="font-extrabold text-sm" style={{ color: SEV_STYLE[sev].text }}>{SEV_STYLE[sev].label}</span>
              </div>
              {node.description && <p className="text-[11px] leading-relaxed mb-2.5" style={{ color: "#94a3b8" }}>{node.description}</p>}
              <div className="flex items-start gap-1.5 p-2 rounded-lg" style={{ background: "#0a0f1e" }}>
                <Info size={10} style={{ color: "#60a5fa", marginTop: 1, flexShrink: 0 }} />
                <p className="text-[10px] leading-relaxed" style={{ color: "#60a5fa" }}>{RECOMMENDATIONS[sev]}</p>
              </div>
            </div>
          )}

          {/* ── Protein/Enzyme/Transporter/Carrier ── */}
          {["target", "enzyme", "transporter", "carrier"].includes(node.nodeType) && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {node.subLabel && (
                  <div className="rounded-xl p-2.5" style={{ background: "#0f172a", border: "1px solid #1e3a5f" }}>
                    <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: "#334155" }}>Gene Symbol</div>
                    <div className="text-sm font-extrabold font-mono" style={{ color: "#60a5fa" }}>{node.subLabel}</div>
                  </div>
                )}
                {node.nodeId && (
                  <div className="rounded-xl p-2.5" style={{ background: "#0f172a", border: "1px solid #1e3a5f" }}>
                    <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: "#334155" }}>UniProt ID</div>
                    <div className="text-xs font-mono truncate" style={{ color: "#94a3b8" }}>{node.nodeId}</div>
                  </div>
                )}
              </div>
              {node.actions && node.actions.length > 0 && (
                <div>
                  <div className="text-[9px] font-extrabold uppercase tracking-widest mb-2" style={{ color: "#334155" }}>Actions</div>
                  <div className="flex flex-wrap gap-1.5">
                    {node.actions.map(a => (
                      <span key={a} className="text-[10px] font-semibold px-2.5 py-1 rounded-full capitalize" style={{ background: ns.color + "20", color: ns.color, border: `1px solid ${ns.color}40` }}>{a}</span>
                    ))}
                  </div>
                </div>
              )}
              {connectedDrugs.length > 0 && (
                <div>
                  <div className="text-[9px] font-extrabold uppercase tracking-widest mb-2" style={{ color: "#334155" }}>Connected Drugs</div>
                  <div className="space-y-1.5">
                    {connectedDrugs.map(cd => (
                      <div key={cd.drugId} className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ background: "#0f172a", border: "1px solid #1e3a5f" }}>
                        <span className="text-[11px] font-semibold truncate flex-1" style={{ color: "#e2e8f0" }}>{cd.drugName}</span>
                        <div className="flex gap-1 ml-1">
                          {cd.actions.slice(0, 2).map(a => (
                            <span key={a} className="text-[9px] px-1.5 py-0.5 rounded capitalize" style={{ background: "#1e3a5f", color: "#64748b" }}>{a}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Gene ── */}
          {node.nodeType === "gene" && geneProteins.length > 0 && (
            <div>
              <div className="text-[9px] font-extrabold uppercase tracking-widest mb-2" style={{ color: "#334155" }}>Expressed Proteins</div>
              <div className="space-y-1.5">
                {geneProteins.map(p => (
                  <div key={p.uniprot} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "#0f172a", border: "1px solid #1e3a5f" }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: NODE_STYLES[p.type as NodeType]?.color ?? "#94a3b8" }} />
                    <span className="text-[11px] font-semibold truncate flex-1" style={{ color: "#e2e8f0" }}>{p.name}</span>
                    <span className="text-[9px] capitalize" style={{ color: "#475569" }}>{p.type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* View Full Profile */}
          {(node.nodeType === "drug_main" || node.nodeType === "drug_int") && (
            <Link
              to={`/drugs/${node.nodeId}`}
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all hover:brightness-125"
              style={{ background: "#1e3a5f", color: "#60a5fa", border: "1px solid #1e3a5f" }}>
              <ExternalLink size={13} /> View Full Drug Profile
            </Link>
          )}

        </div>
      </div>
    </div>
  );
}

/* ─────────── MAIN PAGE ─────────── */
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
  // Per-drug loading state
  const [loadingDrugs, setLoadingDrugs] = useState<Set<string>>(new Set());
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

  /* ── Categories ── */
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/drug_categories.json`)
      .then(r => r.json())
      .then((data: DrugCategory[]) => { setCategories(data); setCatLoading(false); });
  }, []);

  /* ── Category drugs ── */
  useEffect(() => {
    if (!activeCategory) { setCatDrugsFromApi([]); return; }
    let cancelled = false;
    setCatDrugsLoading(true);
    apiFetchDrugsByCategory(activeCategory, 500, true).then(drugs => {
      if (!cancelled) {
        // has_network=true: only drugs with protein data. Fall back to full list only if 0 returned.
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

  /* ── Resize ── */
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const e = entries[0];
      if (e) setGraphDimensions({ width: e.contentRect.width, height: Math.max(640, e.contentRect.height) });
    });
    if (graphContainerRef.current) obs.observe(graphContainerRef.current);
    return () => obs.disconnect();
  }, []);

  /* ── Search ── */
  useEffect(() => {
    if (networkSearch.length < 2) { setNetworkSuggestions([]); return; }
    const ctrl = new AbortController();
    const q = networkSearch.toLowerCase();
    apiSearchDrugs(networkSearch, ctrl.signal)
      .then(r => setNetworkSuggestions(
        (r.length > 0 ? r : localDrugs.filter(d => d.name.toLowerCase().includes(q)))
          .filter(d => !networkDrugs.find(s => s.id === d.id)).slice(0, 8),
      ))
      .catch(() => setNetworkSuggestions(
        localDrugs.filter(d => d.name.toLowerCase().includes(q) && !networkDrugs.find(s => s.id === d.id)).slice(0, 8),
      ));
    return () => ctrl.abort();
  }, [networkSearch, networkDrugs, localDrugs]);

  /* ── Fetch network for ONE drug (auto-triggered on add) ── */
  const fetchDrugNetwork = useCallback(async (drug: DrugEntry) => {
    setLoadingDrugs(prev => { const s = new Set(prev); s.add(drug.id); return s; });
    try {
      const data = await apiFetchDrugNetwork(drug.id, 300);
      if (data) {
        setNetworkData(prev => new Map(prev).set(drug.id, data));
      }
    } finally {
      setLoadingDrugs(prev => { const s = new Set(prev); s.delete(drug.id); return s; });
      // zoom after short delay
      setTimeout(() => graphRef.current?.zoomToFit(600, 60), 500);
    }
  }, []);

  /* ── Refresh all ── */
  const refreshAll = useCallback(() => {
    for (const drug of networkDrugs) fetchDrugNetwork(drug);
  }, [networkDrugs, fetchDrugNetwork]);

  /* ── Add drug → auto-fetch ── */
  const addNetworkDrug = useCallback((drug: DrugEntry) => {
    if (networkDrugs.length >= 6 || networkDrugs.find(d => d.id === drug.id)) return;
    setNetworkDrugs(prev => [...prev, drug]);
    setNetworkSearch(""); setNetworkSuggestions([]);
    // Auto-fetch immediately
    fetchDrugNetwork(drug);
  }, [networkDrugs, fetchDrugNetwork]);

  /* ── Remove drug ── */
  const removeNetworkDrug = useCallback((id: string) => {
    setNetworkDrugs(prev => prev.filter(d => d.id !== id));
    setNetworkData(prev => { const m = new Map(prev); m.delete(id); return m; });
    setSelectedNode(null);
  }, []);

  const toggleFilter = useCallback((type: NodeType) => {
    setActiveFilters(prev => { const s = new Set(prev); if (s.has(type)) s.delete(type); else s.add(type); return s; });
  }, []);

  /* ── Build graph ──
     Priority:
     1. All drug_main nodes (always)
     2. Drug-drug links between selected drugs (no extra nodes)
     3. Proteins for each drug — all proteins are fetched from API, maxNodes controls how many to DISPLAY
     4. External drug_int nodes (if filter active)
  */
  const graphData = useMemo(() => {
    if (networkDrugs.length === 0 && networkData.size === 0)
      return { nodes: [] as GraphNode[], links: [] as GraphLink[] };

    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const nodeIds = new Set<string>();
    const add = (n: GraphNode) => { if (!nodeIds.has(n.id as string)) { nodeIds.add(n.id as string); nodes.push(n); } };

    // All drug_main nodes always included (even while still loading)
    for (const drug of networkDrugs) {
      const data = networkData.get(drug.id);
      add({
        id: `drug_${drug.id}`, nodeId: drug.id, label: drug.name, subLabel: drug.id,
        nodeType: "drug_main",
        description: data?.drug.description, mechanism: data?.drug.mechanism, groups: data?.drug.groups,
      });
    }

    // Drug-drug interaction links between selected drugs
    const seenPairs = new Set<string>();
    for (const drug of networkDrugs) {
      const data = networkData.get(drug.id); if (!data) continue;
      for (const ix of data.interactions) {
        const partner = networkDrugs.find(d => d.id === ix.drug_id);
        if (!partner) continue;
        const pk = [drug.id, ix.drug_id].sort().join(":");
        if (seenPairs.has(pk)) continue;
        seenPairs.add(pk);
        links.push({ source: `drug_${drug.id}`, target: `drug_${partner.id}`, severity: ix.severity, linkLabel: `${normSev(ix.severity)} risk` });
      }
    }

    // Proteins: ALL proteins fetched from API, display up to maxNodes
    // Budget split evenly across drugs; proteins ALWAYS shown first (before drug_int)
    const drugsWithData = networkDrugs.filter(d => networkData.has(d.id));
    const proteinBudgetPerDrug = drugsWithData.length > 0
      ? Math.max(5, Math.floor((maxNodes - networkDrugs.length) / drugsWithData.length))
      : 20;

    for (const drug of networkDrugs) {
      const data = networkData.get(drug.id); if (!data) continue;
      let added = 0;
      for (const p of data.proteins) {
        if (added >= proteinBudgetPerDrug) break;
        const nt = p.type as NodeType;
        if (!activeFilters.has(nt)) continue;
        const nid = `protein_${p.uniprot_id}`;
        const isNew = !nodeIds.has(nid);
        if (isNew) {
          add({ id: nid, nodeId: p.uniprot_id, label: p.name, subLabel: p.gene_name || "", nodeType: nt, actions: p.actions });
          added++;
        }
        // Always add the link from drug to this protein
        links.push({ source: `drug_${drug.id}`, target: nid, linkLabel: p.actions[0] ?? nt });
        // Gene sub-node
        if (p.gene_name && activeFilters.has("gene")) {
          const gid = `gene_${p.gene_name}`;
          if (!nodeIds.has(gid)) add({ id: gid, nodeId: p.gene_name, label: p.gene_name, nodeType: "gene" });
          // Only add gene link if protein node exists
          if (nodeIds.has(nid)) links.push({ source: nid, target: gid, linkLabel: "expressed" });
        }
      }
    }

    // External drug_int nodes (remaining budget)
    if (activeFilters.has("drug_int")) {
      const remaining = maxNodes - nodes.length;
      if (remaining > 0) {
        const intPerDrug = Math.max(1, Math.ceil(remaining / Math.max(1, networkDrugs.length)));
        for (const drug of networkDrugs) {
          const data = networkData.get(drug.id); if (!data) continue;
          let cnt = 0;
          for (const ix of data.interactions) {
            if (cnt >= intPerDrug || nodes.length >= maxNodes) break;
            if (networkDrugs.find(d => d.id === ix.drug_id)) continue;
            const did = `drug_${ix.drug_id}`;
            if (!nodeIds.has(did)) {
              add({ id: did, nodeId: ix.drug_id, label: ix.name || ix.drug_id, subLabel: ix.drug_id, nodeType: "drug_int", description: ix.description, severity: ix.severity });
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
    return {
      nodes,
      links: links.filter(l => validIds.has(l.source as string) && validIds.has(l.target as string)),
    };
  }, [networkData, networkDrugs, activeFilters, maxNodes]);

  /* ── Stats ── */
  const stats = useMemo(() => {
    const c = { drugs: 0, targets: 0, enzymes: 0, transporters: 0, carriers: 0, drug_int: 0, genes: 0, totalProteins: 0 };
    for (const n of graphData.nodes) {
      if (n.nodeType === "drug_main") c.drugs++;
      if (n.nodeType === "target") { c.targets++; c.totalProteins++; }
      if (n.nodeType === "enzyme") { c.enzymes++; c.totalProteins++; }
      if (n.nodeType === "transporter") { c.transporters++; c.totalProteins++; }
      if (n.nodeType === "carrier") { c.carriers++; c.totalProteins++; }
      if (n.nodeType === "drug_int") c.drug_int++;
      if (n.nodeType === "gene") c.genes++;
    }
    return c;
  }, [graphData.nodes]);

  /* ── Render helpers ── */
  const nodeCanvasObject = useCallback((raw: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const node = raw as GraphNode;
    const ns = NODE_STYLES[node.nodeType];
    const x = node.x ?? 0, y = node.y ?? 0;
    const r = ns.size;
    const isSelected = selectedNode?.id === node.id;
    drawNodeShape(ctx, x, y, r, ns.shape, ns.color, isSelected);
    const showLabel = globalScale >= 0.7 || node.nodeType === "drug_main";
    if (showLabel) {
      const maxLen = node.nodeType === "drug_main" ? 16 : 12;
      const lbl = node.label.length > maxLen ? node.label.substring(0, maxLen - 1) + "…" : node.label;
      const fontSize = Math.max(4, (node.nodeType === "drug_main" ? 10 : 7.5) / globalScale);
      ctx.font = `${node.nodeType === "drug_main" ? "600 " : ""}${fontSize}px Inter,sans-serif`;
      ctx.textAlign = "center"; ctx.fillStyle = "#e2e8f0";
      ctx.shadowColor = "#00000099"; ctx.shadowBlur = 5;
      ctx.fillText(lbl, x, y + r + fontSize + 2);
      ctx.shadowBlur = 0;
    }
  }, [selectedNode]);

  const linkColor = useCallback((raw: LinkObject) => {
    const l = raw as GraphLink;
    if (l.severity === "major") return "#ef444466";
    if (l.severity === "moderate") return "#f59e0b55";
    return "#ffffff14";
  }, []);

  const isLoading = loadingDrugs.size > 0;
  const hasData = networkData.size > 0;
  const cc = (col: string) => CAT_COLORS[col] ?? CAT_COLORS.blue;
  const activeCat = categories.find(c => c.key === activeCategory);
  const catDrugsFiltered = catDrugsFromApi.length > 0 ? catDrugsFromApi : (activeCat?.drugs ?? []);

  /* ─────────── RENDER ─────────── */
  return (
    <div className="min-h-screen" style={{ background: "#070e1a" }}>

      {/* PAGE HEADER */}
      <div className="text-white pt-8 pb-10" style={{ background: "linear-gradient(135deg,#0a1628 0%,#0d1e38 40%,#0e1f3a 100%)" }}>
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center gap-2 text-blue-400 text-sm mb-4">
            <Link to="/" className="hover:text-white transition-colors">Home</Link>
            <ChevronRight size={14} />
            <span className="text-white font-medium">Drug Interaction Network</span>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "#1d4ed820", border: "1px solid #1d4ed850" }}>
                <Network size={24} className="text-blue-400" />
              </div>
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight">Drug Interaction Network</h1>
                <p className="text-blue-400 text-sm mt-0.5">Molecular network visualization · 33,227 protein links · Click a drug to start</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-emerald-300 bg-emerald-900/20 border border-emerald-700/30 px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              DrugBank v5 · 17,430 drugs
            </div>
          </div>
          {/* Stats bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "DRUGS IN NETWORK", val: stats.drugs,           col: "#1d4ed8" },
              { label: "TOTAL NODES",      val: graphData.nodes.length, col: "#8b5cf6" },
              { label: "CONNECTIONS",      val: graphData.links.length, col: "#f59e0b" },
              { label: "PROTEIN TARGETS",  val: stats.targets,          col: "#ef4444" },
            ].map(s => (
              <div key={s.label} className="rounded-2xl p-4" style={{ background: s.col + "18", border: `1px solid ${s.col}30` }}>
                <div className="text-[9px] font-extrabold tracking-widest mb-1" style={{ color: s.col + "bb" }}>{s.label}</div>
                <div className="text-4xl font-extrabold" style={{ color: s.col }}>{s.val}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="rounded-3xl overflow-hidden" style={{ background: "#0b1628", border: "1px solid #1e3a5f" }}>

          {/* ── Filter Tampilan bar ── */}
          <div className="px-5 py-3 border-b" style={{ borderColor: "#1e3a5f", background: "#080e1c" }}>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="w-1 h-5 rounded-full" style={{ background: "#1d4ed8" }} />
                <span className="text-xs font-extrabold tracking-wide" style={{ color: "#94a3b8" }}>Filter Tampilan</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {FILTER_TYPES.map(({ key, label }) => {
                  const active = activeFilters.has(key);
                  const ns = NODE_STYLES[key];
                  return (
                    <button
                      key={key}
                      onClick={() => toggleFilter(key)}
                      className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full transition-all"
                      style={{
                        background: active ? ns.color : "#0f172a",
                        color: active ? "#ffffff" : "#334155",
                        border: `2px solid ${active ? ns.color : "#1e2d47"}`,
                        boxShadow: active ? `0 0 8px ${ns.color}40` : "none",
                      }}>
                      <span className="w-2 h-2 rounded-full" style={{ background: active ? "#fff" : ns.color }} />
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-[11px] font-semibold" style={{ color: "#475569" }}>Max Nodes</span>
                <input type="range" min={10} max={300} step={5} value={maxNodes}
                  onChange={e => setMaxNodes(Number(e.target.value))} className="w-28 accent-blue-500" />
                <span className="text-sm font-extrabold w-8" style={{ color: "#60a5fa" }}>{maxNodes}</span>
              </div>
            </div>
          </div>

          {/* ── Graph top bar ── */}
          <div className="px-5 py-2 border-b flex items-center justify-between flex-wrap gap-2" style={{ borderColor: "#1e3a5f44" }}>
            <div className="flex items-center gap-2 flex-wrap">
              {networkDrugs.map(drug => {
                const data = networkData.get(drug.id);
                const loading = loadingDrugs.has(drug.id);
                const pCount = data ? data.proteins.length : 0;
                const iCount = data ? data.interactions.length : 0;
                return (
                  <div key={drug.id} className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs" style={{ background: "#1e3a5f", border: "1px solid #1e4a70" }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: NODE_STYLES.drug_main.color }} />
                    <span className="font-semibold" style={{ color: "#93c5fd" }}>{drug.name}</span>
                    {loading
                      ? <Loader2 size={10} className="animate-spin" style={{ color: "#60a5fa" }} />
                      : data
                        ? <span className="font-mono text-[10px]" style={{ color: "#475569" }}>{pCount}P·{iCount}I</span>
                        : <span className="text-[10px]" style={{ color: "#ef4444" }}>no data</span>
                    }
                  </div>
                );
              })}
              {networkDrugs.length === 0 && (
                <span className="text-xs" style={{ color: "#334155" }}>← Select drugs to build the network</span>
              )}
            </div>
            {hasData && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono" style={{ color: "#334155" }}>{graphData.nodes.length} nodes · {graphData.links.length} edges</span>
                <button onClick={() => graphRef.current?.zoomToFit(400, 60)} className="text-xs px-2.5 py-1 rounded-lg flex items-center gap-1" style={{ background: "#1e3a5f", color: "#94a3b8" }}>
                  <RefreshCw size={10} /> Fit
                </button>
                <button onClick={() => setPhysicsEnabled(p => !p)} className="text-xs px-2.5 py-1 rounded-lg" style={{ background: physicsEnabled ? "#1d4ed822" : "#1e3a5f", color: physicsEnabled ? "#60a5fa" : "#94a3b8", border: physicsEnabled ? "1px solid #1d4ed855" : "none" }}>
                  Physics {physicsEnabled ? "ON" : "OFF"}
                </button>
                <button onClick={() => refreshAll()} disabled={isLoading} className="text-xs px-2.5 py-1 rounded-lg flex items-center gap-1 disabled:opacity-40" style={{ background: "#1e3a5f", color: "#94a3b8" }}>
                  {isLoading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Refresh
                </button>
                <button onClick={() => { const c = graphContainerRef.current?.querySelector("canvas"); if (!c) return; const a = document.createElement("a"); a.download = "network.png"; a.href = (c as HTMLCanvasElement).toDataURL(); a.click(); }}
                  className="text-xs px-2.5 py-1 rounded-lg flex items-center gap-1" style={{ background: "#1e3a5f", color: "#94a3b8" }}>
                  <Maximize2 size={10} /> Export
                </button>
              </div>
            )}
          </div>

          <div className="flex" style={{ minHeight: "680px" }}>

            {/* ══ LEFT PANEL ══ */}
            <div className="shrink-0 border-r flex flex-col" style={{ width: "268px", borderColor: "#1e3a5f", overflowY: "auto", maxHeight: "680px" }}>

              {/* Search */}
              <div className="px-3 pt-3 pb-2">
                <div className="text-[9px] font-extrabold uppercase tracking-widest mb-2" style={{ color: "#334155" }}>Search Drug</div>
                <div className="relative">
                  <div className="flex items-center gap-2 rounded-xl px-3 py-2 border" style={{ background: "#0a0f1e", borderColor: "#1e3a5f" }}>
                    <Search size={11} style={{ color: "#334155" }} />
                    <input
                      type="text" value={networkSearch} onChange={e => setNetworkSearch(e.target.value)}
                      placeholder="Drug name or DrugBank ID…" className="flex-1 text-xs bg-transparent outline-none" style={{ color: "#e2e8f0" }}
                      onKeyDown={e => { if (e.key === "Enter" && networkSuggestions.length > 0) { e.preventDefault(); addNetworkDrug(networkSuggestions[0]); } }} />
                    {networkSearch && <button onClick={() => { setNetworkSearch(""); setNetworkSuggestions([]); }} style={{ color: "#334155" }}><X size={10} /></button>}
                  </div>
                  {networkSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-30 shadow-2xl" style={{ background: "#0a0f1e", border: "1px solid #1e3a5f" }}>
                      {networkSuggestions.map(d => (
                        <button key={d.id} onClick={() => addNetworkDrug(d)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors">
                          <Plus size={10} style={{ color: "#60a5fa" }} />
                          <span className="text-xs font-medium truncate flex-1" style={{ color: "#e2e8f0" }}>{d.name}</span>
                          <span className="text-[10px] font-mono shrink-0" style={{ color: "#334155" }}>{d.id}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Demo quick-add */}
              <div className="px-3 pb-2">
                <div className="text-[9px] font-extrabold uppercase tracking-widest mb-1.5" style={{ color: "#334155" }}>Quick Demo Drugs</div>
                <div className="flex flex-wrap gap-1">
                  {DEMO_DRUGS.filter(d => !networkDrugs.find(s => s.id === d.id)).slice(0, 6 - networkDrugs.length).map(d => (
                    <button key={d.id} onClick={() => addNetworkDrug(d)}
                      className="text-[10px] flex items-center gap-1 px-2 py-1 rounded-full transition-all hover:brightness-125"
                      style={{ background: "#1e3a5f80", color: "#60a5fa", border: "1px solid #1e3a5f" }}>
                      <Plus size={8} /> {d.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Selected drugs */}
              <div className="px-3 pb-2 border-b" style={{ borderColor: "#1e3a5f" }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[9px] font-extrabold uppercase tracking-widest" style={{ color: "#334155" }}>Selected ({networkDrugs.length}/6)</span>
                  {networkDrugs.length > 0 && (
                    <button onClick={() => { setNetworkDrugs([]); setNetworkData(new Map()); setSelectedNode(null); }}
                      className="text-[10px] hover:text-red-400 transition-colors" style={{ color: "#334155" }}>Clear all</button>
                  )}
                </div>
                {networkDrugs.length === 0
                  ? <p className="text-[11px]" style={{ color: "#1e3a5f" }}>No drugs selected yet</p>
                  : (
                    <div className="flex flex-wrap gap-1.5">
                      {networkDrugs.map(d => (
                        <div key={d.id} className="flex items-center gap-1 px-2.5 py-1 rounded-full" style={{ background: "#1e3a5f" }}>
                          {loadingDrugs.has(d.id) && <Loader2 size={8} className="animate-spin" style={{ color: "#60a5fa" }} />}
                          {!loadingDrugs.has(d.id) && <span className="w-1.5 h-1.5 rounded-full" style={{ background: networkData.has(d.id) ? "#1d4ed8" : "#ef4444" }} />}
                          <span className="text-[11px] font-semibold truncate" style={{ color: "#93c5fd", maxWidth: "80px" }}>{d.name}</span>
                          <button onClick={() => removeNetworkDrug(d.id)} style={{ color: "#334155" }} className="hover:text-red-400"><X size={9} /></button>
                        </div>
                      ))}
                    </div>
                  )}
              </div>

              {/* Disease categories */}
              <div className="px-3 pt-2 pb-1">
                <div className="text-[9px] font-extrabold uppercase tracking-widest mb-2" style={{ color: "#334155" }}>Disease Categories</div>
                {catLoading
                  ? <div className="flex items-center gap-1.5 py-2 text-xs" style={{ color: "#334155" }}><Loader2 size={10} className="animate-spin" /> Loading…</div>
                  : (
                    <div className="flex flex-wrap gap-1.5">
                      {categories.map(cat => {
                        const isActive = activeCategory === cat.key;
                        const cols = cc(cat.color);
                        return (
                          <button key={cat.key} onClick={() => setActiveCategory(isActive ? null : cat.key)}
                            className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full ring-1 transition-all ${isActive ? `${cols.bg} ${cols.tx} ${cols.rg}` : "ring-transparent"}`}
                            style={isActive ? {} : { background: "#0a0f1e", color: "#475569" }}>
                            <span>{cat.icon}</span>
                            <span>{cat.label}</span>
                            <span className="text-[9px] opacity-50">{cat.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
              </div>

              {/* Drug list from category — only drugs with network data */}
              {activeCategory && (
                <div className="px-3 pb-3 border-b" style={{ borderColor: "#1e3a5f" }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-extrabold uppercase tracking-widest" style={{ color: "#334155" }}>
                        {activeCat?.icon} {activeCat?.label}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "#22c55e18", color: "#22c55e", border: "1px solid #22c55e30" }}>
                        {catDrugsFiltered.length} with data
                      </span>
                    </div>
                    {catDrugsFiltered.length === 0 && !catDrugsLoading && (
                      <span className="text-[9px]" style={{ color: "#ef4444" }}>no network data</span>
                    )}
                  </div>
                  {catDrugsLoading
                    ? <div className="flex items-center justify-center py-4 gap-1.5 text-xs" style={{ color: "#334155" }}><Loader2 size={11} className="animate-spin" /> Loading…</div>
                    : catDrugsFiltered.length === 0
                      ? (
                        <p className="text-[11px] py-3 text-center leading-relaxed" style={{ color: "#334155" }}>
                          No drugs in this category have protein network data.
                        </p>
                      )
                      : (
                        <div className="space-y-px max-h-56 overflow-y-auto pr-0.5">
                          {catDrugsFiltered.map(drug => {
                            const isSel = !!networkDrugs.find(s => s.id === drug.id);
                            const disabled = !isSel && networkDrugs.length >= 6;
                            const totalP = (drug.targetCount ?? 0) + (drug.enzymeCount ?? 0);
                            return (
                              <button key={drug.id} onClick={() => isSel ? removeNetworkDrug(drug.id) : addNetworkDrug(drug)}
                                disabled={disabled}
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all disabled:opacity-30"
                                style={{ background: isSel ? "#1e3a5f" : "transparent", color: isSel ? "#93c5fd" : "#64748b" }}
                                onMouseEnter={e => { if (!isSel && !disabled) (e.currentTarget as HTMLButtonElement).style.background = "#0a0f1e"; }}
                                onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
                                <span className="truncate flex-1 text-left font-medium">{drug.name}</span>
                                <div className="flex items-center gap-1 shrink-0">
                                  {totalP > 0 && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "#ef444418", color: "#ef4444" }}>{totalP}P</span>
                                  )}
                                  {isSel ? <X size={8} style={{ color: "#60a5fa" }} /> : <Plus size={8} style={{ color: "#334155" }} />}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                </div>
              )}

              {/* Network summary stats */}
              {hasData && (
                <div className="px-3 py-3">
                  <div className="text-[9px] font-extrabold uppercase tracking-widest mb-2" style={{ color: "#334155" }}>Network Summary</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { label: "Targets",  val: stats.targets,      col: "#ef4444" },
                      { label: "Genes",    val: stats.genes,         col: "#a855f7" },
                      { label: "Drug Int", val: stats.drug_int,      col: "#f97316" },
                      { label: "Enzymes",  val: stats.enzymes,       col: "#06b6d4" },
                      { label: "Transp.",  val: stats.transporters,  col: "#22c55e" },
                      { label: "Carriers", val: stats.carriers,      col: "#f59e0b" },
                    ].map(s => (
                      <div key={s.label} className="rounded-xl p-2 text-center" style={{ background: s.col + "18", border: `1px solid ${s.col}28` }}>
                        <div className="text-lg font-extrabold leading-none" style={{ color: s.col }}>{s.val}</div>
                        <div className="text-[8px] font-bold mt-0.5" style={{ color: "#334155" }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ══ GRAPH CANVAS ══ */}
            <div className="flex-1 relative overflow-hidden" ref={graphContainerRef} style={{ minHeight: "680px" }}>

              {/* Loading overlay */}
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                  <div className="flex items-center gap-2 px-4 py-2 rounded-full text-sm" style={{ background: "#0b1628cc", border: "1px solid #1e3a5f" }}>
                    <Loader2 size={14} className="animate-spin text-blue-400" />
                    <span style={{ color: "#60a5fa" }}>Fetching network data…</span>
                  </div>
                </div>
              )}

              {networkDrugs.length === 0 ? (
                /* Empty state — no drugs selected */
                <div className="w-full h-full flex flex-col items-center justify-center">
                  <div className="text-center space-y-5">
                    <div className="w-28 h-28 rounded-full flex items-center justify-center mx-auto" style={{ border: "2px dashed #1e3a5f" }}>
                      <Network size={44} style={{ color: "#1e3a5f" }} />
                    </div>
                    <div>
                      <p className="font-extrabold text-xl mb-1" style={{ color: "#1e3a5f" }}>No Drug Selected</p>
                      <p className="text-sm max-w-xs mx-auto leading-relaxed" style={{ color: "#1e2d47" }}>
                        Use Quick Demo Drugs or search for a drug on the left. The network will build automatically.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {DEMO_DRUGS.slice(0, 4).map(d => (
                        <button key={d.id} onClick={() => addNetworkDrug(d)}
                          className="text-xs font-bold px-4 py-2 rounded-full transition-all hover:brightness-125"
                          style={{ background: "#1d4ed822", color: "#60a5fa", border: "1px solid #1d4ed855" }}>
                          + {d.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : !hasData && !isLoading ? (
                /* Drugs selected but no protein data found */
                <div className="w-full h-full flex flex-col items-center justify-center">
                  <div className="text-center space-y-4 max-w-sm">
                    <AlertCircle size={40} style={{ color: "#f59e0b", margin: "0 auto" }} />
                    <div>
                      <p className="font-bold text-base mb-1" style={{ color: "#f59e0b" }}>No Protein Data Found</p>
                      <p className="text-sm leading-relaxed" style={{ color: "#475569" }}>
                        The selected drug(s) may not have protein interaction data in our database.
                        Try demo drugs like <span style={{ color: "#60a5fa" }}>Dexamethasone</span> or <span style={{ color: "#60a5fa" }}>Simvastatin</span> for rich networks.
                      </p>
                    </div>
                    <button onClick={refreshAll} className="text-xs px-4 py-2 rounded-full" style={{ background: "#1e3a5f", color: "#60a5fa" }}>
                      <RefreshCw size={11} className="inline mr-1" /> Retry
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <ForceGraph2D
                    ref={graphRef}
                    graphData={graphData}
                    width={graphDimensions.width - (selectedNode ? 300 : 0)}
                    height={graphDimensions.height}
                    backgroundColor="#0b1628"
                    nodeCanvasObject={nodeCanvasObject}
                    nodePointerAreaPaint={(raw, color, ctx) => {
                      const node = raw as GraphNode;
                      const r = NODE_STYLES[node.nodeType].size * 2;
                      ctx.fillStyle = color; ctx.beginPath();
                      ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, Math.PI * 2); ctx.fill();
                    }}
                    linkColor={linkColor}
                    linkWidth={raw => { const l = raw as GraphLink; return l.severity === "major" ? 2.5 : l.severity === "moderate" ? 1.8 : 1; }}
                    linkDirectionalArrowLength={3.5}
                    linkDirectionalArrowRelPos={1}
                    linkLabel={raw => (raw as GraphLink).linkLabel ?? ""}
                    onNodeClick={raw => {
                      const n = raw as GraphNode;
                      setSelectedNode(prev => prev?.id === n.id ? null : n);
                    }}
                    cooldownTicks={physicsEnabled ? 300 : 0}
                    d3AlphaDecay={0.02}
                    d3VelocityDecay={0.3}
                  />

                  {/* Empty proteins warning per drug */}
                  {hasData && stats.totalProteins === 0 && stats.drug_int === 0 && (
                    <div className="absolute top-3 left-3 right-3 px-4 py-2 rounded-xl flex items-center gap-2" style={{ background: "#1e2d1aee", border: "1px solid #22c55e30" }}>
                      <AlertCircle size={13} style={{ color: "#f59e0b", flexShrink: 0 }} />
                      <span className="text-xs" style={{ color: "#94a3b8" }}>
                        These drugs have no protein/interaction data in the current dataset. Try <span style={{ color: "#60a5fa" }}>Dexamethasone (DB01234)</span> for a rich network.
                      </span>
                    </div>
                  )}

                  {/* Bottom legend */}
                  <div className="absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 px-3 py-2 rounded-xl" style={{ background: "#060c1888", backdropFilter: "blur(8px)", border: "1px solid #1e3a5f33" }}>
                    {(Object.entries(NODE_STYLES) as [NodeType, (typeof NODE_STYLES)[NodeType]][]).map(([type, ns]) => (
                      <div key={type} className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: ns.color }} />
                        <span className="text-[10px]" style={{ color: "#475569" }}>{ns.label}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Node detail panel */}
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

          {/* Mechanism footer */}
          {hasData && networkDrugs.some(d => networkData.get(d.id)?.drug.mechanism) && (
            <div className="px-5 py-4 border-t" style={{ borderColor: "#1e3a5f" }}>
              <div className="text-[9px] font-extrabold uppercase tracking-widest mb-3" style={{ color: "#334155" }}>Mechanism of Action</div>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {networkDrugs.map(drug => {
                  const data = networkData.get(drug.id);
                  if (!data?.drug.mechanism) return null;
                  return (
                    <div key={drug.id} className="rounded-2xl p-3" style={{ background: "#0a0f1e", border: "1px solid #1e3a5f" }}>
                      <div className="text-xs font-bold mb-1" style={{ color: "#60a5fa" }}>{drug.name}</div>
                      <p className="text-[11px] leading-relaxed line-clamp-3" style={{ color: "#475569" }}>{data.drug.mechanism}</p>
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
