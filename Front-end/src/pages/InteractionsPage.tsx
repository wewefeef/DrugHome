import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import ForceGraph2D, { type NodeObject, type LinkObject } from "react-force-graph-2d";
import {
  Zap, Search, X, ChevronRight, AlertTriangle, AlertCircle,
  CheckCircle2, Database, Shield, Plus, Loader2, Info, ExternalLink,
  Save, Check, LogIn, Maximize2, RefreshCw,
} from "lucide-react";
import { getDrugs } from "../lib/drugCache";
import { apiSearchDrugs, apiFetchDrugsByCategory, apiFetchDrugNetwork } from "../lib/api";
import type { DrugNetworkData } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// TYPES
interface DrugEntry { id: string; name: string; }
interface DrugCategory {
  key: string; label: string; icon: string; color: string;
  count: number; drugs: DrugEntry[];
}
interface InteractionFound {
  drug_a_id: string; drug_a_name: string;
  drug_b_id: string; drug_b_name: string;
  severity: string; description: string; source: string;
}
interface CheckResponse {
  interactions_found: InteractionFound[];
  total_interactions: number;
  has_major: boolean; has_moderate: boolean;
}
type VizState = "idle" | "analyzing" | "done";

// GRAPH TYPES
type NodeType = "drug_main" | "drug_int" | "target" | "enzyme" | "transporter" | "carrier" | "gene";

interface GraphNode extends NodeObject {
  nodeId: string;
  label: string;
  subLabel?: string;
  nodeType: NodeType;
  description?: string;
  mechanism?: string;
  actions?: string[];
  groups?: string[];
  severity?: string;
}

interface GraphLink extends LinkObject {
  linkLabel?: string;
  severity?: string;
}

// CONSTANTS
const SEV: Record<string, { line: string; bg: string; text: string; label: string }> = {
  major:    { line: "#ef4444", bg: "bg-red-50   border-red-100",   text: "text-red-700",   label: "High Risk" },
  moderate: { line: "#f59e0b", bg: "bg-amber-50 border-amber-100", text: "text-amber-700", label: "Moderate"  },
  minor:    { line: "#22c55e", bg: "bg-green-50 border-green-100", text: "text-green-700", label: "Low Risk"  },
  unknown:  { line: "#22c55e", bg: "bg-green-50 border-green-100", text: "text-green-700", label: "Low Risk"  },
};

const normSev = (s: string) => (s === "major" || s === "moderate" || s === "minor") ? s : "minor";

const RECOMMENDATION: Record<string, string> = {
  major:    "Avoid concurrent use. Seek alternative medications. If unavoidable, monitor the patient very closely and adjust doses as needed.",
  moderate: "Monitor the patient closely during concurrent use. Consider dose adjustment if adverse effects appear. Consult a specialist if needed.",
  minor:    "Monitor for any signs of adverse effects. Routine monitoring is generally sufficient for most patients.",
};

const CAT_COLORS: Record<string, { bg: string; tx: string; rg: string }> = {
  red:    { bg: "bg-red-50",     tx: "text-red-700",    rg: "ring-red-200"     },
  rose:   { bg: "bg-rose-50",    tx: "text-rose-700",   rg: "ring-rose-200"    },
  green:  { bg: "bg-emerald-50", tx: "text-emerald-700",rg: "ring-emerald-200" },
  blue:   { bg: "bg-blue-50",    tx: "text-blue-700",   rg: "ring-blue-200"    },
  amber:  { bg: "bg-amber-50",   tx: "text-amber-700",  rg: "ring-amber-200"   },
  violet: { bg: "bg-violet-50",  tx: "text-violet-700", rg: "ring-violet-200"  },
  purple: { bg: "bg-purple-50",  tx: "text-purple-700", rg: "ring-purple-200"  },
  orange: { bg: "bg-orange-50",  tx: "text-orange-700", rg: "ring-orange-200"  },
  sky:    { bg: "bg-sky-50",     tx: "text-sky-700",    rg: "ring-sky-200"     },
  teal:   { bg: "bg-teal-50",    tx: "text-teal-700",   rg: "ring-teal-200"    },
  yellow: { bg: "bg-yellow-50",  tx: "text-yellow-700", rg: "ring-yellow-200"  },
  cyan:   { bg: "bg-cyan-50",    tx: "text-cyan-700",   rg: "ring-cyan-200"    },
  stone:  { bg: "bg-stone-50",   tx: "text-stone-700",  rg: "ring-stone-200"   },
};

const NODE_STYLES: Record<NodeType, { color: string; size: number; shape: string; label: string }> = {
  drug_main:   { color: "#1d4ed8", size: 12, shape: "diamond",  label: "Main Drug"   },
  drug_int:    { color: "#ea580c", size: 7,  shape: "circle",   label: "Interacting Drug" },
  target:      { color: "#dc2626", size: 7,  shape: "hexagon",  label: "Protein Target"   },
  enzyme:      { color: "#2563eb", size: 6,  shape: "triangle", label: "Enzyme"      },
  transporter: { color: "#0891b2", size: 6,  shape: "triangle", label: "Transporter" },
  carrier:     { color: "#d97706", size: 5,  shape: "circle",   label: "Carrier"     },
  gene:        { color: "#7c3aed", size: 5,  shape: "star",     label: "Gene"        },
};

const FILTER_TYPES: { key: NodeType; label: string }[] = [
  { key: "target",      label: "Protein Target"   },
  { key: "gene",        label: "Gene/Genomics"     },
  { key: "drug_int",    label: "Drug Interactions" },
  { key: "enzyme",      label: "Enzyme"            },
  { key: "transporter", label: "Transporter"       },
  { key: "carrier",     label: "Carrier"           },
];

// DRAW HELPERS
function drawNodeShape(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, shape: string, color: string) {
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.strokeStyle = "#ffffff44";
  ctx.lineWidth = 1.2;
  if (shape === "circle") {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  } else if (shape === "diamond") {
    ctx.moveTo(x, y - r * 1.4);
    ctx.lineTo(x + r * 1.0, y);
    ctx.lineTo(x, y + r * 1.4);
    ctx.lineTo(x - r * 1.0, y);
    ctx.closePath();
  } else if (shape === "hexagon") {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      if (i === 0) ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
      else ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    ctx.closePath();
  } else if (shape === "triangle") {
    ctx.moveTo(x, y + r * 1.3);
    ctx.lineTo(x + r * 1.1, y - r * 0.8);
    ctx.lineTo(x - r * 1.1, y - r * 0.8);
    ctx.closePath();
  } else if (shape === "star") {
    const spikes = 5, outerR = r, innerR = r * 0.45;
    for (let i = 0; i < spikes * 2; i++) {
      const angle = (i * Math.PI) / spikes - Math.PI / 2;
      const rad = i % 2 === 0 ? outerR : innerR;
      if (i === 0) ctx.moveTo(x + rad * Math.cos(angle), y + rad * Math.sin(angle));
      else ctx.lineTo(x + rad * Math.cos(angle), y + rad * Math.sin(angle));
    }
    ctx.closePath();
  } else {
    ctx.rect(x - r, y - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.stroke();
}

// INTERACTION MODAL
function InteractionModal({ ix, onClose }: { ix: InteractionFound | null; onClose: () => void }) {
  if (!ix) return null;
  const sev = SEV[normSev(ix.severity)];
  const rec = RECOMMENDATION[normSev(ix.severity)];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
          <div className="flex items-center gap-2 font-bold text-gray-800">
            <AlertTriangle size={16} className="text-amber-500" /> Interaction Details
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors rounded-lg p-1 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 pt-5 pb-4 space-y-4 max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-center gap-4 p-4 bg-gradient-to-br from-slate-50 to-blue-50/50 rounded-xl border border-gray-100">
            <div className="flex flex-col items-center gap-2">
              <div className="w-[72px] h-[36px] rounded-full bg-gradient-to-br from-indigo-500 to-indigo-800 flex items-center justify-center shadow-md">
                <span className="text-[9px] text-white font-bold text-center leading-tight px-1">
                  {ix.drug_a_name.length > 9 ? ix.drug_a_name.substring(0, 8) + "..." : ix.drug_a_name}
                </span>
              </div>
              <span className="text-xs font-semibold text-gray-700 max-w-[90px] text-center leading-snug">{ix.drug_a_name}</span>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${sev.bg} ${sev.text}`}>
                {sev.label} - {ix.source || "DrugBank"}
              </span>
              <ChevronRight size={18} className="text-gray-400" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="w-[72px] h-[36px] rounded-full bg-gradient-to-br from-rose-500 to-rose-800 flex items-center justify-center shadow-md">
                <span className="text-[9px] text-white font-bold text-center leading-tight px-1">
                  {ix.drug_b_name.length > 9 ? ix.drug_b_name.substring(0, 8) + "..." : ix.drug_b_name}
                </span>
              </div>
              <span className="text-xs font-semibold text-gray-700 max-w-[90px] text-center leading-snug">{ix.drug_b_name}</span>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Interaction Type / Mechanism</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-700">DRUGBANK DIRECT</span>
            </div>
            <p className="text-sm font-semibold text-gray-800 leading-snug">
              {ix.description.split(".")[0] || "Drug-Drug Interaction"}
            </p>
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Clinical Impact</div>
            <p className="text-sm text-gray-700 leading-relaxed bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
              {ix.description || "No detailed information available."}
            </p>
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Clinical Recommendation</div>
            <div className="flex items-start gap-2 bg-blue-50 rounded-xl px-3 py-2.5 border border-blue-100">
              <Info size={14} className="text-blue-500 mt-0.5 shrink-0" />
              <p className="text-sm text-blue-800 leading-relaxed">{rec}</p>
            </div>
          </div>
          <div className="flex items-start gap-2 bg-amber-50 rounded-xl px-3 py-2 border border-amber-100">
            <AlertTriangle size={12} className="text-amber-500 mt-0.5 shrink-0" />
            <p className="text-[11px] text-amber-800 leading-snug">
              Always consult a licensed healthcare professional before making clinical decisions based on this information.
            </p>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-[10px] text-gray-400">Data source: DrugBank v5 - 2026</span>
          <button onClick={onClose} className="text-primary-600 hover:text-primary-800 font-semibold text-xs transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

// MAIN PAGE
export default function InteractionsPage() {
  const { token } = useAuth();

  // Category / drug selection state
  const [categories, setCategories] = useState<DrugCategory[]>([]);
  const [catLoading, setCatLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [catDrugsFromApi, setCatDrugsFromApi] = useState<DrugEntry[]>([]);
  const [catDrugsLoading, setCatDrugsLoading] = useState(false);
  const [selectedDrugs, setSelectedDrugs] = useState<DrugEntry[]>([]);
  const [drugSearch, setDrugSearch] = useState("");
  const [drugSuggestions, setDrugSuggestions] = useState<DrugEntry[]>([]);
  const [localDrugs, setLocalDrugs] = useState<{ id: string; name: string }[]>([]);

  // Interaction checker state
  const [vizState, setVizState] = useState<VizState>("idle");
  const [interactions, setInteractions] = useState<InteractionFound[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [modalIx, setModalIx] = useState<InteractionFound | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "guest">("idle");
  const [restored, setRestored] = useState(false);

  // Network visualization state
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
  const [graphDimensions, setGraphDimensions] = useState({ width: 800, height: 520 });

  // Session restore
  useEffect(() => {
    if (token) {
      fetch("/api/v1/sessions?limit=1", { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : [])
        .then((sessions: Array<{ id: number; drugs_snapshot?: { id: string; name: string }[] }>) => {
          if (!sessions.length || !sessions[0].drugs_snapshot?.length) return;
          return fetch(`/api/v1/sessions/${sessions[0].id}`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.ok ? r.json() : null)
            .then((detail: { drugs_snapshot: DrugEntry[]; interactions_found: InteractionFound[] } | null) => {
              if (!detail?.drugs_snapshot?.length) return;
              setSelectedDrugs(detail.drugs_snapshot);
              if (detail.interactions_found?.length >= 0) {
                setInteractions(detail.interactions_found);
                setVizState("done");
                setRestored(true);
              }
            });
        })
        .catch(() => {});
    } else {
      try {
        const raw = sessionStorage.getItem("medidb_guest_session");
        if (raw) {
          const detail: { drugs_snapshot: DrugEntry[]; interactions_found: InteractionFound[] } = JSON.parse(raw);
          if (detail.drugs_snapshot?.length) {
            setSelectedDrugs(detail.drugs_snapshot);
            if (detail.interactions_found?.length >= 0) {
              setInteractions(detail.interactions_found);
              setVizState("done");
              setRestored(true);
            }
          }
        }
      } catch { /* ignore */ }
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load categories
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/drug_categories.json`)
      .then(r => r.json())
      .then((data: DrugCategory[]) => { setCategories(data); setCatLoading(false); });
  }, []);

  // Load drugs for active category
  useEffect(() => {
    if (!activeCategory) { setCatDrugsFromApi([]); return; }
    let cancelled = false;
    setCatDrugsLoading(true);
    apiFetchDrugsByCategory(activeCategory, 300).then(drugs => {
      if (!cancelled) {
        if (drugs.length > 0) {
          setCatDrugsFromApi(drugs);
        } else {
          const staticCat = categories.find(c => c.key === activeCategory);
          setCatDrugsFromApi(staticCat?.drugs ?? []);
        }
        setCatDrugsLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [activeCategory, categories]);

  // Load local drugs fallback
  useEffect(() => {
    getDrugs().then(drugs => {
      if (drugs.length > 0) setLocalDrugs(drugs.map(d => ({ id: d.id, name: d.name })));
    });
    fetch(`${import.meta.env.BASE_URL}data/drugs.json`)
      .then(r => r.json())
      .then((data: { id: string; name: string }[]) => {
        setLocalDrugs(prev => prev.length > 0 ? prev : data.map(d => ({ id: d.id, name: d.name })));
      })
      .catch(() => {});
  }, []);

  // Graph container dimensions
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        setGraphDimensions({ width: entry.contentRect.width, height: Math.max(520, entry.contentRect.height) });
      }
    });
    if (graphContainerRef.current) obs.observe(graphContainerRef.current);
    return () => obs.disconnect();
  }, []);

  // Autocomplete for interaction checker
  useEffect(() => {
    if (drugSearch.length < 2) { setDrugSuggestions([]); return; }
    const controller = new AbortController();
    const q = drugSearch.toLowerCase();
    apiSearchDrugs(drugSearch, controller.signal)
      .then(results => {
        if (results.length > 0) {
          setDrugSuggestions(results.filter(d => !selectedDrugs.find(s => s.id === d.id)).slice(0, 8));
        } else {
          setDrugSuggestions(localDrugs.filter(d => d.name.toLowerCase().includes(q) && !selectedDrugs.find(s => s.id === d.id)).slice(0, 8));
        }
      })
      .catch(() => {
        setDrugSuggestions(localDrugs.filter(d => d.name.toLowerCase().includes(drugSearch.toLowerCase()) && !selectedDrugs.find(s => s.id === d.id)).slice(0, 8));
      });
    return () => controller.abort();
  }, [drugSearch, selectedDrugs, localDrugs]);

  // Autocomplete for network search
  useEffect(() => {
    if (networkSearch.length < 2) { setNetworkSuggestions([]); return; }
    const controller = new AbortController();
    const q = networkSearch.toLowerCase();
    apiSearchDrugs(networkSearch, controller.signal)
      .then(results => {
        if (results.length > 0) {
          setNetworkSuggestions(results.filter(d => !networkDrugs.find(s => s.id === d.id)).slice(0, 8));
        } else {
          setNetworkSuggestions(localDrugs.filter(d => d.name.toLowerCase().includes(q) && !networkDrugs.find(s => s.id === d.id)).slice(0, 8));
        }
      })
      .catch(() => {
        setNetworkSuggestions(localDrugs.filter(d => d.name.toLowerCase().includes(q) && !networkDrugs.find(s => s.id === d.id)).slice(0, 8));
      });
    return () => controller.abort();
  }, [networkSearch, networkDrugs, localDrugs]);

  // Build graph data
  const graphData = useMemo(() => {
    if (networkDrugs.length === 0 || networkData.size === 0) return { nodes: [] as GraphNode[], links: [] as GraphLink[] };

    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const nodeIds = new Set<string>();

    const addNode = (n: GraphNode) => {
      if (!nodeIds.has(n.id as string)) {
        nodeIds.add(n.id as string);
        nodes.push(n);
      }
    };

    for (const drug of networkDrugs) {
      const data = networkData.get(drug.id);
      if (!data) continue;

      addNode({
        id: `drug_${drug.id}`,
        nodeId: drug.id,
        label: drug.name,
        subLabel: drug.id,
        nodeType: "drug_main",
        description: data.drug.description,
        mechanism: data.drug.mechanism,
        groups: data.drug.groups,
      });

      for (const p of data.proteins) {
        const nt = p.type as NodeType;
        if (!activeFilters.has(nt)) continue;
        const nid = `protein_${p.uniprot_id}`;
        if (!nodeIds.has(nid)) {
          addNode({ id: nid, nodeId: p.uniprot_id, label: p.name, subLabel: p.gene_name, nodeType: nt, actions: p.actions });
        }
        links.push({ source: `drug_${drug.id}`, target: nid, linkLabel: p.actions[0] ?? p.type });

        if (p.gene_name && activeFilters.has("gene")) {
          const gid = `gene_${p.gene_name}`;
          if (!nodeIds.has(gid)) {
            addNode({ id: gid, nodeId: p.gene_name, label: p.gene_name, nodeType: "gene" });
          }
          links.push({ source: nid, target: gid, linkLabel: "expressed" });
        }
      }

      if (activeFilters.has("drug_int")) {
        const maxDrugInts = Math.max(5, Math.floor(maxNodes / (networkDrugs.length || 1) / 2));
        for (const ix of data.interactions.slice(0, maxDrugInts)) {
          const did = `drug_${ix.drug_id}`;
          if (!nodeIds.has(did)) {
            addNode({ id: did, nodeId: ix.drug_id, label: ix.name, subLabel: ix.drug_id, nodeType: "drug_int", description: ix.description, severity: ix.severity });
          }
          links.push({ source: `drug_${drug.id}`, target: did, linkLabel: ix.severity, severity: ix.severity });
        }
      }
    }

    const limitedNodes = nodes.slice(0, maxNodes);
    const limitedIds = new Set(limitedNodes.map(n => n.id as string));
    const limitedLinks = links.filter(l => limitedIds.has(l.source as string) && limitedIds.has(l.target as string));
    return { nodes: limitedNodes, links: limitedLinks };
  }, [networkData, networkDrugs, activeFilters, maxNodes]);

  const networkStats = useMemo(() => {
    const counts = { targets: 0, enzymes: 0, transporters: 0, carriers: 0, drug_interactions: 0, genes: 0 };
    for (const n of graphData.nodes) {
      if (n.nodeType === "target")      counts.targets++;
      if (n.nodeType === "enzyme")      counts.enzymes++;
      if (n.nodeType === "transporter") counts.transporters++;
      if (n.nodeType === "carrier")     counts.carriers++;
      if (n.nodeType === "drug_int")    counts.drug_interactions++;
      if (n.nodeType === "gene")        counts.genes++;
    }
    return counts;
  }, [graphData.nodes]);

  // Interaction checker helpers
  const resetViz = useCallback(() => { setVizState("idle"); setInteractions([]); setApiError(null); }, []);

  const clearAll = useCallback(() => {
    setSelectedDrugs([]); setDrugSearch(""); setDrugSuggestions([]);
    setVizState("idle"); setInteractions([]); setApiError(null); setRestored(false);
  }, []);

  const addDrug = useCallback((drug: DrugEntry) => {
    if (selectedDrugs.length >= 8 || selectedDrugs.find(s => s.id === drug.id)) return;
    setSelectedDrugs(prev => [...prev, drug]);
    setDrugSearch(""); setDrugSuggestions([]);
    setVizState("idle"); setInteractions([]); setApiError(null);
  }, [selectedDrugs]);

  const removeDrug = useCallback((id: string) => {
    setSelectedDrugs(prev => prev.filter(d => d.id !== id));
    resetViz();
  }, [resetViz]);

  const autoSave = useCallback(async (drugs: DrugEntry[], found: InteractionFound[]) => {
    if (drugs.length < 2) return;
    if (!token) {
      try { sessionStorage.setItem("medidb_guest_session", JSON.stringify({ drugs_snapshot: drugs, interactions_found: found })); } catch { /* ignore */ }
      setSaveState("guest");
      setTimeout(() => setSaveState("idle"), 4000);
      return;
    }
    setSaveState("saving");
    try {
      const normSevFn = (s: string) => (["major","moderate","minor"].includes(s) ? s : "minor");
      const payload = {
        drugs_snapshot: drugs.map(d => ({ id: d.id, name: d.name })),
        interactions_found: found.map(r => ({ ...r, source: r.source ?? "DrugBank" })),
        total_drugs: drugs.length, total_interactions: found.length,
        major_count: found.filter(r => normSevFn(r.severity) === "major").length,
        moderate_count: found.filter(r => normSevFn(r.severity) === "moderate").length,
        minor_count: found.filter(r => normSevFn(r.severity) === "minor").length,
      };
      const res = await fetch("/api/v1/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 3000);
    } catch { setSaveState("idle"); }
  }, [token]);

  const checkInteractions = useCallback(async () => {
    if (selectedDrugs.length < 2) return;
    setVizState("analyzing"); setApiError(null);
    try {
      const res = await fetch("/api/v1/analysis/check-interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drug_ids: selectedDrugs.map(d => d.id) }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const detail = (errBody as { detail?: unknown }).detail;
        let message: string;
        if (typeof detail === "string") message = detail;
        else if (detail && typeof detail === "object" && "message" in detail) message = (detail as { message: string }).message;
        else if (Array.isArray(detail) && detail.length > 0 && (detail[0] as { msg?: string }).msg) message = (detail as { msg: string }[]).map(d => d.msg).join(", ");
        else message = `HTTP ${res.status}`;
        throw new Error(message);
      }
      const data: CheckResponse = await res.json();
      const found = data.interactions_found ?? [];
      setInteractions(found);
      setVizState("done");
      autoSave(selectedDrugs, found);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to connect. Is the backend running on port 8000?");
      setVizState("idle");
    }
  }, [selectedDrugs, autoSave]);

  // Network helpers
  const addNetworkDrug = useCallback((drug: DrugEntry) => {
    if (networkDrugs.length >= 6 || networkDrugs.find(d => d.id === drug.id)) return;
    setNetworkDrugs(prev => [...prev, drug]);
    setNetworkSearch(""); setNetworkSuggestions([]);
  }, [networkDrugs]);

  const removeNetworkDrug = useCallback((id: string) => {
    setNetworkDrugs(prev => prev.filter(d => d.id !== id));
    setNetworkData(prev => { const m = new Map(prev); m.delete(id); return m; });
  }, []);

  const visualizeNetwork = useCallback(async () => {
    if (networkDrugs.length === 0) return;
    setNetworkLoading(true); setSelectedNode(null);
    const results = await Promise.all(networkDrugs.map(d => apiFetchDrugNetwork(d.id, maxNodes)));
    const newData = new Map<string, DrugNetworkData>();
    networkDrugs.forEach((d, i) => { if (results[i]) newData.set(d.id, results[i]!); });
    setNetworkData(newData);
    setNetworkLoading(false);
    setTimeout(() => graphRef.current?.zoomToFit(600, 40), 800);
  }, [networkDrugs, maxNodes]);

  const toggleFilter = (type: NodeType) => {
    setActiveFilters(prev => { const next = new Set(prev); if (next.has(type)) next.delete(type); else next.add(type); return next; });
  };

  // Derived stats
  const highCount = interactions.filter(r => normSev(r.severity) === "major").length;
  const modCount  = interactions.filter(r => normSev(r.severity) === "moderate").length;
  const lowCount  = interactions.filter(r => normSev(r.severity) === "minor").length;

  const allPairs = useMemo(() => {
    if (vizState !== "done") return [];
    return selectedDrugs.flatMap((a, i) =>
      selectedDrugs.slice(i + 1).map(b => ({
        a, b,
        ix: interactions.find(r => (r.drug_a_id === a.id && r.drug_b_id === b.id) || (r.drug_a_id === b.id && r.drug_b_id === a.id)) ?? null,
      }))
    );
  }, [vizState, selectedDrugs, interactions]);

  const activeCat = categories.find(c => c.key === activeCategory);
  const catDrugsFiltered = catDrugsFromApi.length > 0
    ? catDrugsFromApi.filter(d => !drugSearch || d.name.toLowerCase().includes(drugSearch.toLowerCase()))
    : (activeCat?.drugs ?? []).filter(d => !drugSearch || d.name.toLowerCase().includes(drugSearch.toLowerCase()));
  const cc = (col: string) => CAT_COLORS[col] ?? CAT_COLORS.blue;

  // Canvas node renderer
  const nodeCanvasObject = useCallback((rawNode: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const node = rawNode as GraphNode;
    const style = NODE_STYLES[node.nodeType];
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const r = style.size * (node.nodeType === "drug_main" ? 1.2 : 1);
    drawNodeShape(ctx, x, y, r, style.shape, style.color);
    if (globalScale > 1.2 || node.nodeType === "drug_main") {
      const maxLen = node.nodeType === "drug_main" ? 14 : 10;
      const lbl = node.label.length > maxLen ? node.label.substring(0, maxLen - 1) + "..." : node.label;
      const fontSize = Math.max(3, 8 / globalScale);
      ctx.font = `${node.nodeType === "drug_main" ? "bold " : ""}${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 3;
      ctx.fillText(lbl, x, y + r + fontSize + 1);
      ctx.shadowBlur = 0;
    }
  }, []);

  const linkColor = useCallback((rawLink: LinkObject) => {
    const link = rawLink as GraphLink;
    if (link.severity === "major") return "#ef444488";
    if (link.severity === "moderate") return "#f59e0b88";
    return "#ffffff22";
  }, []);

  return (
    <>
      <InteractionModal ix={modalIx} onClose={() => setModalIx(null)} />

      <div className="min-h-screen bg-gray-50">
        {/* PAGE HEADER */}
        <div className="bg-gradient-to-r from-primary-950 via-primary-900 to-primary-800 text-white pt-8 pb-10">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-center gap-2 text-blue-300 text-sm mb-4">
              <Link to="/" className="hover:text-white transition-colors">Home</Link>
              <ChevronRight size={14} />
              <span className="text-white font-medium">Drug Interaction Analysis</span>
            </div>
            <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center">
                    <Zap size={22} className="text-amber-300" />
                  </div>
                  <h1 className="text-3xl font-extrabold tracking-tight">Drug Interaction Analysis System</h1>
                </div>
                <p className="text-blue-300 text-sm mt-1 pl-1">
                  Molecular network visualization - 24,386 interaction pairs from DrugBank - 3-level risk assessment
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-emerald-300 bg-emerald-900/30 border border-emerald-700/40 px-3 py-1.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                DrugBank Data - 2026
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "SELECTED DRUGS",     val: selectedDrugs.length,   icon: "DRUG", cls: "from-red-900/60    to-red-800/40    border-red-700/40"     },
                { label: "NETWORK NODES",      val: graphData.nodes.length, icon: "NODE", cls: "from-violet-900/60 to-violet-800/40 border-violet-700/40" },
                { label: "NETWORK EDGES",      val: graphData.links.length, icon: "EDGE", cls: "from-amber-900/60  to-amber-800/40  border-amber-700/40"  },
                { label: "INTERACTIONS FOUND", val: interactions.length,     icon: "INT",  cls: "from-emerald-900/60 to-emerald-800/40 border-emerald-700/40" },
              ].map(s => (
                <div key={s.label} className={`rounded-2xl border p-4 bg-gradient-to-br ${s.cls}`}>
                  <div className="text-[10px] font-bold text-gray-400 tracking-widest mb-1">{s.label}</div>
                  <div className="flex items-end justify-between">
                    <span className="text-4xl font-extrabold text-white">{s.val}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

          {/* SECTION 1: MOLECULAR NETWORK MAP */}
          <div className="rounded-3xl overflow-hidden" style={{ background: "#0b1628", border: "1px solid #1e3a5f" }}>
            <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "#1e3a5f" }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#1e3a5f" }}>
                  <Zap size={16} className="text-blue-400" />
                </div>
                <div>
                  <h2 className="text-white font-bold text-base">Molecular Network Map</h2>
                  <p className="text-xs" style={{ color: "#64748b" }}>Visualize drug-protein-gene interaction networks</p>
                </div>
              </div>
              {networkData.size > 0 && (
                <div className="flex items-center gap-2">
                  <button onClick={() => graphRef.current?.zoomToFit(600, 40)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                    style={{ background: "#1e3a5f", color: "#94a3b8" }}>
                    <RefreshCw size={12} /> Reset View
                  </button>
                  <button onClick={() => setPhysicsEnabled(p => !p)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                    style={{ background: physicsEnabled ? "#1d4ed844" : "#1e3a5f", color: physicsEnabled ? "#60a5fa" : "#94a3b8", border: physicsEnabled ? "1px solid #1d4ed8" : "1px solid transparent" }}>
                    {physicsEnabled ? "Physics ON" : "Physics OFF"}
                  </button>
                  <button
                    onClick={() => {
                      const canvas = graphContainerRef.current?.querySelector("canvas");
                      if (!canvas) return;
                      const a = document.createElement("a");
                      a.download = "drug_network.png";
                      a.href = (canvas as HTMLCanvasElement).toDataURL("image/png");
                      a.click();
                    }}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                    style={{ background: "#1e3a5f", color: "#94a3b8" }}>
                    <Maximize2 size={12} /> Export
                  </button>
                </div>
              )}
            </div>

            <div className="flex" style={{ minHeight: "580px" }}>
              {/* Left panel */}
              <div className="w-72 shrink-0 border-r flex flex-col" style={{ borderColor: "#1e3a5f" }}>
                <div className="p-4 border-b" style={{ borderColor: "#1e3a5f" }}>
                  <div className="text-xs font-bold mb-3" style={{ color: "#64748b" }}>SELECT DRUGS (max 6)</div>
                  <div className="space-y-2">
                    {networkDrugs.map(d => (
                      <div key={d.id} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "#1e3a5f" }}>
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#1d4ed8" }} />
                        <span className="flex-1 text-xs font-medium truncate" style={{ color: "#e2e8f0" }}>{d.name}</span>
                        <span className="text-[10px] font-mono shrink-0" style={{ color: "#475569" }}>{d.id}</span>
                        <button onClick={() => removeNetworkDrug(d.id)} style={{ color: "#475569" }} className="hover:text-red-400 transition-colors ml-1">
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    {networkDrugs.length < 6 && (
                      <div className="relative">
                        <div className="flex items-center gap-2 rounded-lg px-3 py-2 border" style={{ background: "#0f172a", borderColor: "#1e3a5f" }}>
                          <Search size={11} style={{ color: "#475569" }} />
                          <input type="text" value={networkSearch} onChange={e => setNetworkSearch(e.target.value)}
                            placeholder="Add drug by name or ID..."
                            className="flex-1 text-xs bg-transparent outline-none"
                            style={{ color: "#e2e8f0" }}
                            onKeyDown={e => { if (e.key === "Enter" && networkSuggestions.length > 0) { e.preventDefault(); addNetworkDrug(networkSuggestions[0]); } }} />
                        </div>
                        {networkSuggestions.length > 0 && (
                          <div className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden shadow-2xl z-20" style={{ background: "#0f172a", border: "1px solid #1e3a5f" }}>
                            {networkSuggestions.map(d => (
                              <button key={d.id} onClick={() => addNetworkDrug(d)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors">
                                <Plus size={10} style={{ color: "#60a5fa" }} />
                                <span className="text-xs font-medium truncate flex-1" style={{ color: "#e2e8f0" }}>{d.name}</span>
                                <span className="text-[10px] font-mono shrink-0" style={{ color: "#475569" }}>{d.id}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-3">
                    <div className="text-[10px] font-bold mb-2" style={{ color: "#475569" }}>QUICK ADD</div>
                    <div className="flex flex-wrap gap-1">
                      {[
                        { id: "DB00945", name: "Aspirin" }, { id: "DB01050", name: "Ibuprofen" },
                        { id: "DB00682", name: "Warfarin" }, { id: "DB00331", name: "Metformin" },
                        { id: "DB01060", name: "Amoxicillin" }, { id: "DB00641", name: "Simvastatin" },
                      ].map(d => {
                        const isSel = !!networkDrugs.find(s => s.id === d.id);
                        return (
                          <button key={d.id} onClick={() => isSel ? removeNetworkDrug(d.id) : addNetworkDrug(d)}
                            className="text-[10px] px-2 py-0.5 rounded-full transition-all"
                            style={{ background: isSel ? "#1d4ed8" : "#1e3a5f", color: isSel ? "#ffffff" : "#94a3b8" }}>
                            {isSel ? "- " : "+ "}{d.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <button onClick={visualizeNetwork} disabled={networkDrugs.length === 0 || networkLoading}
                    className="w-full mt-4 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                    style={{ background: "#1d4ed8", color: "#ffffff" }}>
                    {networkLoading ? <><Loader2 size={14} className="animate-spin" /> Loading network...</> : <><Zap size={14} /> Visualize Network</>}
                  </button>
                </div>

                <div className="p-4 border-b" style={{ borderColor: "#1e3a5f" }}>
                  <div className="text-xs font-bold mb-3" style={{ color: "#64748b" }}>FILTER NODE TYPES</div>
                  <div className="flex flex-wrap gap-1.5">
                    {FILTER_TYPES.map(({ key, label }) => {
                      const active = activeFilters.has(key);
                      const ns = NODE_STYLES[key];
                      return (
                        <button key={key} onClick={() => toggleFilter(key)}
                          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg transition-all"
                          style={{ background: active ? ns.color + "33" : "#0f172a", color: active ? ns.color : "#475569", border: `1px solid ${active ? ns.color + "66" : "#1e3a5f"}` }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: active ? ns.color : "#475569" }} />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="p-4 border-b" style={{ borderColor: "#1e3a5f" }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-bold" style={{ color: "#64748b" }}>MAX NODES</div>
                    <span className="text-xs font-bold" style={{ color: "#60a5fa" }}>{maxNodes}</span>
                  </div>
                  <input type="range" min={10} max={300} value={maxNodes} onChange={e => setMaxNodes(Number(e.target.value))} className="w-full accent-blue-500" />
                  <div className="flex justify-between text-[10px] mt-0.5" style={{ color: "#334155" }}><span>10</span><span>300</span></div>
                </div>

                <div className="flex-1 p-4 overflow-y-auto">
                  {selectedNode ? (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-xs font-bold" style={{ color: "#64748b" }}>NODE DETAIL</div>
                        <button onClick={() => setSelectedNode(null)} style={{ color: "#475569" }}><X size={12} /></button>
                      </div>
                      <div className="space-y-2.5">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-block" style={{ background: NODE_STYLES[selectedNode.nodeType].color + "33", color: NODE_STYLES[selectedNode.nodeType].color }}>
                          {NODE_STYLES[selectedNode.nodeType].label}
                        </span>
                        <div className="font-bold text-sm" style={{ color: "#e2e8f0" }}>{selectedNode.label}</div>
                        {selectedNode.subLabel && <div className="text-xs font-mono" style={{ color: "#475569" }}>{selectedNode.subLabel}</div>}
                        {selectedNode.actions && selectedNode.actions.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {selectedNode.actions.slice(0, 5).map(a => (
                              <span key={a} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#1e3a5f", color: "#94a3b8" }}>{a}</span>
                            ))}
                          </div>
                        )}
                        {selectedNode.description && <p className="text-[11px] leading-relaxed" style={{ color: "#64748b" }}>{selectedNode.description}</p>}
                        {(selectedNode.nodeType === "drug_main" || selectedNode.nodeType === "drug_int") && (
                          <Link to={`/drugs/${selectedNode.nodeId}`} className="block text-center text-[11px] font-semibold py-1.5 rounded-lg" style={{ background: "#1e3a5f", color: "#60a5fa" }}>
                            View full profile
                          </Link>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8" style={{ color: "#334155" }}>
                      <p className="text-xs">Click any node to view details</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Graph canvas */}
              <div className="flex-1 relative">
                <div ref={graphContainerRef} className="w-full" style={{ height: "580px" }}>
                  {networkData.size > 0 ? (
                    <ForceGraph2D
                      ref={graphRef}
                      graphData={graphData}
                      width={graphDimensions.width}
                      height={graphDimensions.height}
                      backgroundColor="#0b1628"
                      nodeCanvasObject={nodeCanvasObject}
                      nodePointerAreaPaint={(rawNode, color, ctx) => {
                        const node = rawNode as GraphNode;
                        const r = NODE_STYLES[node.nodeType].size * 1.5;
                        ctx.fillStyle = color;
                        ctx.beginPath();
                        ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, Math.PI * 2);
                        ctx.fill();
                      }}
                      linkColor={linkColor}
                      linkWidth={1.2}
                      linkDirectionalArrowLength={4}
                      linkDirectionalArrowRelPos={1}
                      linkLabel={(rawLink) => (rawLink as GraphLink).linkLabel ?? ""}
                      onNodeClick={(rawNode) => setSelectedNode(rawNode as GraphNode)}
                      cooldownTicks={physicsEnabled ? 300 : 0}
                      d3AlphaDecay={0.02}
                      d3VelocityDecay={0.3}
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center">
                      <div className="text-center space-y-3">
                        <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto" style={{ border: "2px dashed #1e3a5f" }}>
                          <Zap size={32} style={{ color: "#1e3a5f" }} />
                        </div>
                        <p className="font-bold" style={{ color: "#334155" }}>No Network Loaded</p>
                        <p className="text-sm" style={{ color: "#1e3a5f" }}>Add drugs and click Visualize Network</p>
                      </div>
                    </div>
                  )}
                </div>

                {networkData.size > 0 && (
                  <div className="absolute bottom-4 left-4 flex flex-wrap gap-2 p-2 rounded-xl" style={{ background: "#0b162888", backdropFilter: "blur(8px)" }}>
                    {(Object.entries(NODE_STYLES) as [NodeType, { color: string; size: number; shape: string; label: string }][]).map(([type, ns]) => (
                      <div key={type} className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: ns.color }} />
                        <span className="text-[10px]" style={{ color: "#64748b" }}>{ns.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {networkData.size > 0 && (
              <div className="px-6 py-4 border-t" style={{ borderColor: "#1e3a5f" }}>
                <div className="text-xs font-bold mb-3" style={{ color: "#64748b" }}>NETWORK SUMMARY</div>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                  {[
                    { label: "Targets",      val: networkStats.targets,          color: "#dc2626" },
                    { label: "Genes",        val: networkStats.genes,            color: "#7c3aed" },
                    { label: "Drug Int.",    val: networkStats.drug_interactions, color: "#ea580c" },
                    { label: "Enzymes",      val: networkStats.enzymes,          color: "#2563eb" },
                    { label: "Transporters", val: networkStats.transporters,     color: "#0891b2" },
                    { label: "Carriers",     val: networkStats.carriers,         color: "#d97706" },
                  ].map(s => (
                    <div key={s.label} className="rounded-xl p-3 text-center" style={{ background: s.color + "1a", border: `1px solid ${s.color}33` }}>
                      <div className="text-2xl font-extrabold" style={{ color: s.color }}>{s.val}</div>
                      <div className="text-[10px] font-bold mt-0.5" style={{ color: "#475569" }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                {networkDrugs.length > 0 && Array.from(networkData.values()).some(d => d.drug.mechanism) && (
                  <div className="mt-4">
                    <div className="text-xs font-bold mb-2" style={{ color: "#64748b" }}>MECHANISM OF ACTION</div>
                    <div className="grid md:grid-cols-2 gap-3">
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
            )}
          </div>

          {/* SECTION 2: INTERACTION CHECKER */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                  <Shield size={16} className="text-primary-700" />
                </div>
                <div>
                  <h2 className="font-bold text-gray-800 text-base">Quick Interaction Checker</h2>
                  <p className="text-xs text-gray-500">Select drugs by category or search - get 3-level risk assessment</p>
                </div>
              </div>
            </div>

            <div className="grid lg:grid-cols-[280px_1fr_260px] divide-x divide-gray-100">
              {/* Left: Drug selector */}
              <div className="p-4 space-y-3">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Disease Categories</div>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {catLoading
                    ? <div className="flex items-center justify-center py-5 text-gray-400 text-xs"><Loader2 size={14} className="animate-spin mr-2" /> Loading...</div>
                    : categories.map(cat => {
                        const isActive = activeCategory === cat.key;
                        const cols = cc(cat.color);
                        return (
                          <button key={cat.key} onClick={() => setActiveCategory(isActive ? null : cat.key)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-sm font-medium transition-all ${isActive ? `${cols.bg} ${cols.tx} ring-1 ${cols.rg}` : "text-gray-700 hover:bg-gray-50"}`}>
                            <span className="text-base shrink-0">{cat.icon}</span>
                            <span className="flex-1 truncate">{cat.label}</span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isActive ? `bg-white/60 ${cols.tx}` : "bg-gray-100 text-gray-400"}`}>
                              {isActive && catDrugsFromApi.length > 0 ? catDrugsFromApi.length : cat.count}
                            </span>
                          </button>
                        );
                      })}
                </div>

                <div className="relative">
                  <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2 border border-gray-200 focus-within:border-primary-300 focus-within:bg-white transition-all">
                    <Search size={13} className="text-gray-400 shrink-0" />
                    <input type="text" value={drugSearch} onChange={e => setDrugSearch(e.target.value)}
                      placeholder="Search drugs..."
                      className="flex-1 text-xs bg-transparent outline-none text-gray-700 placeholder-gray-400"
                      onKeyDown={e => { if (e.key === "Enter" && drugSuggestions.length > 0) { e.preventDefault(); addDrug(drugSuggestions[0]); } }} />
                    {drugSearch && <button onClick={() => { setDrugSearch(""); setDrugSuggestions([]); }}><X size={12} className="text-gray-400" /></button>}
                  </div>
                  {drugSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl border border-gray-200 shadow-lg z-20 overflow-hidden">
                      {drugSuggestions.map(d => (
                        <button key={d.id} onClick={() => addDrug(d)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-primary-50 transition-colors text-left">
                          <Plus size={11} className="text-primary-400 shrink-0" />
                          <span className="text-xs font-medium text-gray-800 truncate">{d.name}</span>
                          <span className="text-[9px] text-gray-400 font-mono shrink-0">{d.id}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {activeCat && !drugSearch && (
                    catDrugsLoading
                      ? <div className="mt-2 flex items-center justify-center py-4 text-gray-400 text-xs"><Loader2 size={13} className="animate-spin mr-1.5" /> Loading drugs...</div>
                      : catDrugsFiltered.length > 0
                        ? <div className="mt-2 space-y-0.5 max-h-48 overflow-y-auto">
                            {catDrugsFiltered.map(drug => {
                              const isSel = !!selectedDrugs.find(s => s.id === drug.id);
                              return (
                                <button key={drug.id} onClick={() => isSel ? removeDrug(drug.id) : addDrug(drug)}
                                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-all ${isSel ? "bg-primary-50 text-primary-700 font-semibold" : "hover:bg-gray-50 text-gray-700"}`}>
                                  <span className="truncate flex-1 text-left">{drug.name}</span>
                                  <div className="flex items-center gap-1 shrink-0 ml-1">
                                    <span className="font-mono text-[9px] text-gray-400">{drug.id}</span>
                                    {isSel ? <X size={10} className="text-primary-400" /> : <Plus size={10} className="text-gray-300" />}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        : null
                  )}
                </div>

                {selectedDrugs.length > 0 && (
                  <div className="border border-gray-100 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Selected ({selectedDrugs.length}/8)</div>
                      <button onClick={clearAll} className="flex items-center gap-1 text-[10px] font-semibold text-red-500 hover:text-red-700 px-2 py-0.5 rounded-lg transition-colors">
                        <X size={9} /> Reset
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedDrugs.map(d => (
                        <div key={d.id} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium bg-primary-50 text-primary-700 border border-primary-100">
                          <span className="truncate max-w-[100px]">{d.name}</span>
                          <button onClick={() => removeDrug(d.id)} className="opacity-70 hover:opacity-100 ml-0.5"><X size={10} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Quick Add</div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { id: "DB00945", name: "Aspirin" }, { id: "DB01050", name: "Ibuprofen" },
                      { id: "DB00682", name: "Warfarin" }, { id: "DB00331", name: "Metformin" },
                      { id: "DB01060", name: "Amoxicillin" }, { id: "DB00091", name: "Cyclosporine" },
                      { id: "DB00641", name: "Simvastatin" }, { id: "DB01381", name: "Acetaminophen" },
                    ].map(d => {
                      const isSel = !!selectedDrugs.find(s => s.id === d.id);
                      return (
                        <button key={d.id} onClick={() => isSel ? removeDrug(d.id) : addDrug(d)}
                          className={`text-xs px-2.5 py-1 rounded-full font-medium transition-all ${isSel ? "bg-primary-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-primary-50 hover:text-primary-700"}`}>
                          {isSel && "- "}{d.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Center: Results */}
              <div className="p-4 space-y-4">
                {selectedDrugs.length < 2 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-gray-50 border border-dashed border-gray-200 flex items-center justify-center mb-3">
                      <Zap size={24} className="text-gray-300" />
                    </div>
                    <p className="font-bold text-gray-400 text-sm mb-1">No interactions to display</p>
                    <p className="text-gray-400 text-xs">Add 2-8 drugs to detect interactions.</p>
                  </div>
                ) : vizState !== "done" ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <button onClick={checkInteractions} disabled={vizState === "analyzing"}
                      className="inline-flex items-center gap-2 bg-primary-800 hover:bg-primary-700 disabled:opacity-60 text-white px-8 py-3 rounded-xl font-bold text-sm transition-colors shadow-lg">
                      {vizState === "analyzing"
                        ? <><Loader2 size={16} className="animate-spin" /> Analyzing {selectedDrugs.length} drugs...</>
                        : <><Zap size={16} className="text-amber-300" /> Check Interactions ({selectedDrugs.length} drugs)</>}
                    </button>
                    <p className="text-gray-400 text-xs mt-3">
                      Will check {Math.floor(selectedDrugs.length * (selectedDrugs.length - 1) / 2)} pair{selectedDrugs.length > 2 ? "s" : ""} - Source: DrugBank v5
                    </p>
                  </div>
                ) : (
                  <>
                    {restored && (
                      <div className="flex items-center justify-between bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2.5">
                        <span className="text-xs text-indigo-700 flex items-center gap-1.5">
                          <Check size={11} className="text-indigo-500" /> Restored previous session
                        </span>
                        <button onClick={() => setRestored(false)} className="text-indigo-400 hover:text-indigo-700"><X size={12} /></button>
                      </div>
                    )}
                    {apiError && (
                      <div className="flex items-start gap-2 bg-red-50 border border-red-100 text-red-700 text-xs px-4 py-3 rounded-xl">
                        <AlertCircle size={14} className="shrink-0 mt-0.5" /><span>{apiError}</span>
                      </div>
                    )}
                    <div className="border border-gray-100 rounded-2xl divide-y divide-gray-50 overflow-hidden">
                      {allPairs.map(({ a, b, ix }) => {
                        const s = ix ? SEV[normSev(ix.severity)] : null;
                        return (
                          <div key={`${a.id}-${b.id}`}
                            className={`px-4 py-3 ${ix ? "cursor-pointer hover:bg-gray-50 transition-colors" : ""}`}
                            onClick={() => ix && setModalIx(ix)}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-semibold text-sm text-gray-800 truncate max-w-[120px]">{a.name}</span>
                                <ChevronRight size={13} className="text-gray-300 shrink-0" />
                                <span className="font-semibold text-sm text-gray-800 truncate max-w-[120px]">{b.name}</span>
                              </div>
                              {ix && s ? (
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${s.bg} ${s.text}`}>{s.label}</span>
                                  <ExternalLink size={11} className="text-gray-400" />
                                </div>
                              ) : (
                                <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full shrink-0">No interaction</span>
                              )}
                            </div>
                            {ix?.description && (
                              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed line-clamp-2">{ix.description}</p>
                            )}
                          </div>
                        );
                      })}
                      <div className="px-4 py-3 flex items-center justify-between">
                        <button onClick={() => { setVizState("idle"); setInteractions([]); setRestored(false); }}
                          className="text-xs text-primary-600 hover:text-primary-800 font-semibold transition-colors">
                          Clear and re-check
                        </button>
                        <div className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg ${
                          saveState === "saved"   ? "text-green-700 bg-green-50 border border-green-200"
                          : saveState === "saving" ? "text-amber-600 bg-amber-50 border border-amber-200"
                          : saveState === "guest"  ? "text-orange-600 bg-orange-50 border border-orange-200"
                          : "text-gray-400"}`}>
                          {saveState === "saving" ? <><Loader2 size={12} className="animate-spin" /> Saving...</>
                            : saveState === "saved"  ? <><Check size={12} /> Saved to analysis</>
                            : saveState === "guest"  ? <><LogIn size={12} /> Sign in to save history</>
                            : <><Save size={11} className="opacity-40" /> Auto-save</>}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Right: Stats */}
              <div className="p-4 space-y-4">
                {selectedDrugs.length >= 2 && vizState !== "done" && (
                  <button onClick={checkInteractions} disabled={vizState === "analyzing"}
                    className="w-full flex items-center justify-center gap-2 bg-primary-800 hover:bg-primary-700 disabled:opacity-60 text-white px-4 py-3 rounded-xl font-bold text-sm transition-colors shadow-md">
                    {vizState === "analyzing"
                      ? <><Loader2 size={15} className="animate-spin" /> Analyzing...</>
                      : <><Zap size={15} className="text-amber-300" /> Analyze Interactions</>}
                  </button>
                )}

                <div className="border border-gray-100 rounded-2xl p-4">
                  <div className="flex items-center gap-2 font-bold text-gray-800 text-sm mb-3">
                    <AlertTriangle size={15} className="text-amber-500" /> Risk Overview
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="border border-red-100 bg-red-50 rounded-xl p-2.5 text-center">
                      <div className="text-red-600 text-xl font-extrabold">{highCount}</div>
                      <div className="text-[9px] font-bold text-gray-400 tracking-widest">HIGH</div>
                    </div>
                    <div className="border border-amber-100 bg-amber-50 rounded-xl p-2.5 text-center">
                      <div className="text-amber-600 text-xl font-extrabold">{modCount}</div>
                      <div className="text-[9px] font-bold text-gray-400 tracking-widest">MOD</div>
                    </div>
                    <div className="border border-green-100 bg-green-50 rounded-xl p-2.5 text-center">
                      <div className="text-green-600 text-xl font-extrabold">{lowCount}</div>
                      <div className="text-[9px] font-bold text-gray-400 tracking-widest">LOW</div>
                    </div>
                  </div>
                  {[
                    { label: "High Risk", count: highCount, bar: "bg-red-500"   },
                    { label: "Moderate",  count: modCount,  bar: "bg-amber-400" },
                    { label: "Low Risk",  count: lowCount,  bar: "bg-green-500" },
                  ].map(r => {
                    const max = Math.max(highCount, modCount, lowCount, 1);
                    return (
                      <div key={r.label} className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 w-16 shrink-0">{r.label}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                          <div className={`h-full rounded-full transition-all duration-700 ${r.bar}`} style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
                        </div>
                        <span className="text-xs font-bold text-gray-600 w-3 text-right">{r.count}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="border border-gray-100 rounded-2xl p-4">
                  <div className="flex items-center gap-2 font-bold text-gray-800 text-sm mb-3">
                    <Database size={15} className="text-primary-600" /> Database
                  </div>
                  <div className="space-y-2 text-xs">
                    {[
                      { label: "Total drugs",       val: "17,590" },
                      { label: "Interaction pairs", val: "24,386" },
                      { label: "Class-based rules", val: "33"     },
                      { label: "Source",            val: "DrugBank v5", mono: true },
                    ].map(item => (
                      <div key={item.label} className="flex justify-between">
                        <span className="text-gray-500">{item.label}</span>
                        <span className={`font-semibold text-gray-800 ${item.mono ? "font-mono text-primary-700" : ""}`}>{item.val}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border border-gray-100 rounded-2xl p-4">
                  <div className="flex items-center gap-2 font-bold text-gray-800 text-sm mb-3">
                    <Shield size={15} className="text-primary-600" /> Severity Guide
                  </div>
                  <div className="space-y-2.5">
                    {[
                      { icon: <AlertTriangle size={13} className="text-red-500" />,   label: "High Risk", cls: "bg-red-50   border-red-100",   tx: "text-red-600",   desc: "Avoid combination" },
                      { icon: <AlertCircle   size={13} className="text-amber-500" />, label: "Moderate",  cls: "bg-amber-50 border-amber-100", tx: "text-amber-700", desc: "Monitor closely"   },
                      { icon: <CheckCircle2  size={13} className="text-green-500" />, label: "Low Risk",  cls: "bg-green-50 border-green-100", tx: "text-green-700", desc: "Routine monitoring" },
                    ].map(s => (
                      <div key={s.label} className={`flex items-start gap-2 p-2.5 rounded-xl border ${s.cls}`}>
                        <div className="mt-0.5 shrink-0">{s.icon}</div>
                        <div>
                          <div className={`text-xs font-bold ${s.tx}`}>{s.label}</div>
                          <div className="text-[11px] text-gray-500 leading-snug">{s.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
