import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import ForceGraph2D, { type NodeObject, type LinkObject } from "react-force-graph-2d";
import {
  Zap, Search, X, ChevronRight, Plus, Loader2, RefreshCw, Maximize2, ExternalLink,
} from "lucide-react";
import { getDrugs } from "../lib/drugCache";
import { apiSearchDrugs, apiFetchDrugsByCategory, apiFetchDrugNetwork } from "../lib/api";
import type { DrugNetworkData } from "../lib/api";

// TYPES
interface DrugEntry { id: string; name: string; }
interface DrugCategory {
  key: string; label: string; icon: string; color: string;
  count: number; drugs: DrugEntry[];
}

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
const CAT_COLORS: Record<string, { bg: string; tx: string; rg: string }> = {
  red:    { bg: "bg-red-950/60",     tx: "text-red-300",    rg: "ring-red-500/60"     },
  rose:   { bg: "bg-rose-950/60",    tx: "text-rose-300",   rg: "ring-rose-500/60"    },
  green:  { bg: "bg-emerald-950/60", tx: "text-emerald-300",rg: "ring-emerald-500/60" },
  blue:   { bg: "bg-blue-950/60",    tx: "text-blue-300",   rg: "ring-blue-500/60"    },
  amber:  { bg: "bg-amber-950/60",   tx: "text-amber-300",  rg: "ring-amber-500/60"   },
  violet: { bg: "bg-violet-950/60",  tx: "text-violet-300", rg: "ring-violet-500/60"  },
  purple: { bg: "bg-purple-950/60",  tx: "text-purple-300", rg: "ring-purple-500/60"  },
  orange: { bg: "bg-orange-950/60",  tx: "text-orange-300", rg: "ring-orange-500/60"  },
  sky:    { bg: "bg-sky-950/60",     tx: "text-sky-300",    rg: "ring-sky-500/60"     },
  teal:   { bg: "bg-teal-950/60",    tx: "text-teal-300",   rg: "ring-teal-500/60"    },
  yellow: { bg: "bg-yellow-950/60",  tx: "text-yellow-300", rg: "ring-yellow-500/60"  },
  cyan:   { bg: "bg-cyan-950/60",    tx: "text-cyan-300",   rg: "ring-cyan-500/60"    },
  stone:  { bg: "bg-stone-950/60",   tx: "text-stone-300",  rg: "ring-stone-500/60"   },
};

const NODE_STYLES: Record<NodeType, { color: string; size: number; shape: string; label: string }> = {
  drug_main:   { color: "#1d4ed8", size: 12, shape: "diamond",  label: "Main Drug"        },
  drug_int:    { color: "#ea580c", size: 7,  shape: "circle",   label: "Interacting Drug" },
  target:      { color: "#dc2626", size: 7,  shape: "hexagon",  label: "Protein Target"   },
  enzyme:      { color: "#2563eb", size: 6,  shape: "triangle", label: "Enzyme"           },
  transporter: { color: "#0891b2", size: 6,  shape: "triangle", label: "Transporter"      },
  carrier:     { color: "#d97706", size: 5,  shape: "circle",   label: "Carrier"          },
  gene:        { color: "#7c3aed", size: 5,  shape: "star",     label: "Gene"             },
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

// MAIN PAGE
export default function InteractionsPage() {
  // Category state
  const [categories, setCategories] = useState<DrugCategory[]>([]);
  const [catLoading, setCatLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [catDrugsFromApi, setCatDrugsFromApi] = useState<DrugEntry[]>([]);
  const [catDrugsLoading, setCatDrugsLoading] = useState(false);
  const [localDrugs, setLocalDrugs] = useState<{ id: string; name: string }[]>([]);

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
  const [graphDimensions, setGraphDimensions] = useState({ width: 800, height: 640 });

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
        if (drugs.length > 0) { setCatDrugsFromApi(drugs); }
        else { const staticCat = categories.find(c => c.key === activeCategory); setCatDrugsFromApi(staticCat?.drugs ?? []); }
        setCatDrugsLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [activeCategory, categories]);

  // Load local drugs fallback
  useEffect(() => {
    getDrugs().then(drugs => { if (drugs.length > 0) setLocalDrugs(drugs.map(d => ({ id: d.id, name: d.name }))); });
    fetch(`${import.meta.env.BASE_URL}data/drugs.json`)
      .then(r => r.json())
      .then((data: { id: string; name: string }[]) => { setLocalDrugs(prev => prev.length > 0 ? prev : data.map(d => ({ id: d.id, name: d.name }))); })
      .catch(() => {});
  }, []);

  // Graph container resize observer
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setGraphDimensions({ width: entry.contentRect.width, height: Math.max(640, entry.contentRect.height) });
    });
    if (graphContainerRef.current) obs.observe(graphContainerRef.current);
    return () => obs.disconnect();
  }, []);

  // Autocomplete for network search
  useEffect(() => {
    if (networkSearch.length < 2) { setNetworkSuggestions([]); return; }
    const controller = new AbortController();
    const q = networkSearch.toLowerCase();
    apiSearchDrugs(networkSearch, controller.signal)
      .then(results => {
        if (results.length > 0) setNetworkSuggestions(results.filter(d => !networkDrugs.find(s => s.id === d.id)).slice(0, 8));
        else setNetworkSuggestions(localDrugs.filter(d => d.name.toLowerCase().includes(q) && !networkDrugs.find(s => s.id === d.id)).slice(0, 8));
      })
      .catch(() => { setNetworkSuggestions(localDrugs.filter(d => d.name.toLowerCase().includes(networkSearch.toLowerCase()) && !networkDrugs.find(s => s.id === d.id)).slice(0, 8)); });
    return () => controller.abort();
  }, [networkSearch, networkDrugs, localDrugs]);

  // Build graph data
  const graphData = useMemo(() => {
    if (networkDrugs.length === 0 || networkData.size === 0) return { nodes: [] as GraphNode[], links: [] as GraphLink[] };
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const nodeIds = new Set<string>();
    const addNode = (n: GraphNode) => { if (!nodeIds.has(n.id as string)) { nodeIds.add(n.id as string); nodes.push(n); } };
    for (const drug of networkDrugs) {
      const data = networkData.get(drug.id);
      if (!data) continue;
      addNode({ id: `drug_${drug.id}`, nodeId: drug.id, label: drug.name, subLabel: drug.id, nodeType: "drug_main", description: data.drug.description, mechanism: data.drug.mechanism, groups: data.drug.groups });
      for (const p of data.proteins) {
        const nt = p.type as NodeType;
        if (!activeFilters.has(nt)) continue;
        const nid = `protein_${p.uniprot_id}`;
        if (!nodeIds.has(nid)) addNode({ id: nid, nodeId: p.uniprot_id, label: p.name, subLabel: p.gene_name, nodeType: nt, actions: p.actions });
        links.push({ source: `drug_${drug.id}`, target: nid, linkLabel: p.actions[0] ?? p.type });
        if (p.gene_name && activeFilters.has("gene")) {
          const gid = `gene_${p.gene_name}`;
          if (!nodeIds.has(gid)) addNode({ id: gid, nodeId: p.gene_name, label: p.gene_name, nodeType: "gene" });
          links.push({ source: nid, target: gid, linkLabel: "expressed" });
        }
      }
      if (activeFilters.has("drug_int")) {
        const maxDrugInts = Math.max(5, Math.floor(maxNodes / (networkDrugs.length || 1) / 2));
        for (const ix of data.interactions.slice(0, maxDrugInts)) {
          const did = `drug_${ix.drug_id}`;
          if (!nodeIds.has(did)) addNode({ id: did, nodeId: ix.drug_id, label: ix.name, subLabel: ix.drug_id, nodeType: "drug_int", description: ix.description, severity: ix.severity });
          links.push({ source: `drug_${drug.id}`, target: did, linkLabel: ix.severity, severity: ix.severity });
        }
      }
    }
    const limitedNodes = nodes.slice(0, maxNodes);
    const limitedIds = new Set(limitedNodes.map(n => n.id as string));
    return { nodes: limitedNodes, links: links.filter(l => limitedIds.has(l.source as string) && limitedIds.has(l.target as string)) };
  }, [networkData, networkDrugs, activeFilters, maxNodes]);

  const networkStats = useMemo(() => {
    const counts = { targets: 0, enzymes: 0, transporters: 0, carriers: 0, drug_interactions: 0, genes: 0 };
    for (const n of graphData.nodes) {
      if (n.nodeType === "target") counts.targets++;
      if (n.nodeType === "enzyme") counts.enzymes++;
      if (n.nodeType === "transporter") counts.transporters++;
      if (n.nodeType === "carrier") counts.carriers++;
      if (n.nodeType === "drug_int") counts.drug_interactions++;
      if (n.nodeType === "gene") counts.genes++;
    }
    return counts;
  }, [graphData.nodes]);

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
    const results = await Promise.all(networkDrugs.map(d => apiFetchDrugNetwork(d.id, maxNodes)));
    const newData = new Map<string, DrugNetworkData>();
    networkDrugs.forEach((d, i) => { if (results[i]) newData.set(d.id, results[i]!); });
    setNetworkData(newData); setNetworkLoading(false);
    setTimeout(() => graphRef.current?.zoomToFit(600, 40), 800);
  }, [networkDrugs, maxNodes]);

  const toggleFilter = (type: NodeType) => {
    setActiveFilters(prev => { const next = new Set(prev); if (next.has(type)) next.delete(type); else next.add(type); return next; });
  };

  const cc = (col: string) => CAT_COLORS[col] ?? CAT_COLORS.blue;
  const activeCat = categories.find(c => c.key === activeCategory);
  const catDrugsFiltered = catDrugsFromApi.length > 0 ? catDrugsFromApi : (activeCat?.drugs ?? []);

  const nodeCanvasObject = useCallback((rawNode: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const node = rawNode as GraphNode;
    const style = NODE_STYLES[node.nodeType];
    const x = node.x ?? 0, y = node.y ?? 0;
    const r = style.size * (node.nodeType === "drug_main" ? 1.2 : 1);
    drawNodeShape(ctx, x, y, r, style.shape, style.color);
    if (globalScale > 1.2 || node.nodeType === "drug_main") {
      const maxLen = node.nodeType === "drug_main" ? 14 : 10;
      const lbl = node.label.length > maxLen ? node.label.substring(0, maxLen - 1) + "..." : node.label;
      const fontSize = Math.max(3, 8 / globalScale);
      ctx.font = `${node.nodeType === "drug_main" ? "bold " : ""}${fontSize}px sans-serif`;
      ctx.textAlign = "center"; ctx.fillStyle = "#ffffff"; ctx.shadowColor = "#000"; ctx.shadowBlur = 3;
      ctx.fillText(lbl, x, y + r + fontSize + 1); ctx.shadowBlur = 0;
    }
  }, []);

  const linkColor = useCallback((rawLink: LinkObject) => {
    const link = rawLink as GraphLink;
    if (link.severity === "major") return "#ef444488";
    if (link.severity === "moderate") return "#f59e0b88";
    return "#ffffff22";
  }, []);

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
                Molecular network visualization · 24,386 interaction pairs from DrugBank · Select drugs by disease category
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-emerald-300 bg-emerald-900/30 border border-emerald-700/40 px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              DrugBank · 2026
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "NETWORK DRUGS",   val: networkDrugs.length,    cls: "from-blue-900/60    to-blue-800/40    border-blue-700/40"     },
              { label: "NETWORK NODES",   val: graphData.nodes.length, cls: "from-violet-900/60 to-violet-800/40 border-violet-700/40"   },
              { label: "NETWORK EDGES",   val: graphData.links.length, cls: "from-amber-900/60  to-amber-800/40  border-amber-700/40"    },
              { label: "PROTEIN TARGETS", val: networkStats.targets,   cls: "from-red-900/60    to-red-800/40    border-red-700/40"      },
            ].map(s => (
              <div key={s.label} className={`rounded-2xl border p-4 bg-gradient-to-br ${s.cls}`}>
                <div className="text-[10px] font-bold text-gray-400 tracking-widest mb-1">{s.label}</div>
                <span className="text-4xl font-extrabold text-white">{s.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* MOLECULAR NETWORK MAP */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="rounded-3xl overflow-hidden" style={{ background: "#0b1628", border: "1px solid #1e3a5f" }}>

          {/* Section header */}
          <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "#1e3a5f" }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#1e3a5f" }}>
                <Zap size={16} className="text-blue-400" />
              </div>
              <div>
                <h2 className="text-white font-bold text-base">Molecular Network Map</h2>
                <p className="text-xs" style={{ color: "#64748b" }}>
                  Select drugs by disease category · visualize protein-gene interaction networks
                </p>
              </div>
            </div>
            {networkData.size > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => graphRef.current?.zoomToFit(600, 40)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                  style={{ background: "#1e3a5f", color: "#94a3b8" }}>
                  <RefreshCw size={12} /> Reset View
                </button>
                <button
                  onClick={() => setPhysicsEnabled(p => !p)}
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

          <div className="flex" style={{ minHeight: "680px" }}>

            {/* ============ LEFT PANEL ============ */}
            <div className="w-80 shrink-0 border-r flex flex-col" style={{ borderColor: "#1e3a5f", overflowY: "auto", maxHeight: "680px" }}>

              {/* Selected drugs + Visualize */}
              <div className="p-4 border-b" style={{ borderColor: "#1e3a5f" }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-bold" style={{ color: "#64748b" }}>SELECTED DRUGS ({networkDrugs.length}/6)</div>
                  {networkDrugs.length > 0 && (
                    <button
                      onClick={() => { setNetworkDrugs([]); setNetworkData(new Map()); }}
                      className="text-[10px] px-2 py-0.5 rounded-lg transition-colors hover:text-red-400"
                      style={{ color: "#475569" }}>
                      Clear all
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 min-h-[28px] mb-3">
                  {networkDrugs.length === 0
                    ? <p className="text-[11px]" style={{ color: "#334155" }}>Browse categories below to add drugs.</p>
                    : networkDrugs.map(d => (
                        <div key={d.id} className="flex items-center gap-1 rounded-full px-2.5 py-1" style={{ background: "#1e3a5f" }}>
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#1d4ed8" }} />
                          <span className="text-xs font-medium truncate max-w-[100px]" style={{ color: "#e2e8f0" }}>{d.name}</span>
                          <button onClick={() => removeNetworkDrug(d.id)} className="ml-0.5 hover:text-red-400 transition-colors" style={{ color: "#475569" }}>
                            <X size={10} />
                          </button>
                        </div>
                      ))
                  }
                </div>
                <button
                  onClick={visualizeNetwork}
                  disabled={networkDrugs.length === 0 || networkLoading}
                  className="w-full py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  style={{ background: "#1d4ed8", color: "#ffffff" }}>
                  {networkLoading
                    ? <><Loader2 size={14} className="animate-spin" /> Loading network...</>
                    : <><Zap size={14} /> Visualize Network</>}
                </button>
              </div>

              {/* Search */}
              <div className="px-4 pt-3 pb-2">
                <div className="text-xs font-bold mb-2" style={{ color: "#64748b" }}>SEARCH DRUG</div>
                <div className="relative">
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2 border" style={{ background: "#0f172a", borderColor: "#1e3a5f" }}>
                    <Search size={11} style={{ color: "#475569" }} />
                    <input
                      type="text"
                      value={networkSearch}
                      onChange={e => setNetworkSearch(e.target.value)}
                      placeholder="Drug name or ID..."
                      className="flex-1 text-xs bg-transparent outline-none"
                      style={{ color: "#e2e8f0" }}
                      onKeyDown={e => { if (e.key === "Enter" && networkSuggestions.length > 0) { e.preventDefault(); addNetworkDrug(networkSuggestions[0]); } }}
                    />
                    {networkSearch && (
                      <button onClick={() => { setNetworkSearch(""); setNetworkSuggestions([]); }} style={{ color: "#475569" }}>
                        <X size={10} />
                      </button>
                    )}
                  </div>
                  {networkSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden shadow-2xl z-30" style={{ background: "#0f172a", border: "1px solid #1e3a5f" }}>
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
              </div>

              {/* Disease Categories */}
              <div className="px-4 pt-2 pb-2">
                <div className="text-xs font-bold mb-2" style={{ color: "#64748b" }}>DISEASE CATEGORIES</div>
                {catLoading
                  ? <div className="flex items-center gap-1.5 py-2 text-xs" style={{ color: "#475569" }}><Loader2 size={12} className="animate-spin" /> Loading...</div>
                  : (
                    <div className="flex flex-wrap gap-1.5">
                      {categories.map(cat => {
                        const isActive = activeCategory === cat.key;
                        const cols = cc(cat.color);
                        return (
                          <button
                            key={cat.key}
                            onClick={() => setActiveCategory(isActive ? null : cat.key)}
                            className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-all ring-1 ${isActive ? `${cols.bg} ${cols.tx} ${cols.rg}` : "ring-transparent"}`}
                            style={isActive ? {} : { background: "#0f172a", color: "#64748b" }}>
                            <span>{cat.icon}</span>
                            <span>{cat.label}</span>
                            <span className="text-[9px] opacity-60 ml-0.5">
                              {isActive && catDrugsFromApi.length > 0 ? catDrugsFromApi.length : cat.count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )
                }
              </div>

              {/* Drug list from selected category */}
              {activeCategory && (
                <div className="px-4 pb-3 flex-1 border-b" style={{ borderColor: "#1e3a5f" }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#475569" }}>
                      {activeCat?.icon} {activeCat?.label}
                    </div>
                    <span className="text-[10px]" style={{ color: "#334155" }}>{catDrugsFiltered.length} drugs</span>
                  </div>
                  {catDrugsLoading
                    ? <div className="flex items-center gap-1.5 py-4 justify-center text-xs" style={{ color: "#475569" }}><Loader2 size={12} className="animate-spin" /> Loading drugs...</div>
                    : catDrugsFiltered.length === 0
                      ? <p className="text-xs py-2" style={{ color: "#334155" }}>No drugs found.</p>
                      : (
                        <div className="space-y-0.5 max-h-56 overflow-y-auto pr-1">
                          {catDrugsFiltered.map(drug => {
                            const isSel = !!networkDrugs.find(s => s.id === drug.id);
                            const disabled = !isSel && networkDrugs.length >= 6;
                            return (
                              <button
                                key={drug.id}
                                onClick={() => isSel ? removeNetworkDrug(drug.id) : addNetworkDrug(drug)}
                                disabled={disabled}
                                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-all disabled:opacity-30"
                                style={{ background: isSel ? "#1e3a5f" : "transparent", color: isSel ? "#93c5fd" : "#94a3b8" }}
                                onMouseEnter={e => { if (!isSel && !disabled) (e.currentTarget as HTMLButtonElement).style.background = "#0f172a"; }}
                                onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
                                <span className="truncate flex-1 text-left font-medium">{drug.name}</span>
                                <div className="flex items-center gap-1 shrink-0 ml-1">
                                  <span className="font-mono text-[9px]" style={{ color: "#334155" }}>{drug.id}</span>
                                  {isSel ? <X size={10} style={{ color: "#60a5fa" }} /> : <Plus size={10} style={{ color: "#334155" }} />}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )
                  }
                </div>
              )}

              {/* Filter node types + max nodes */}
              <div className="p-4 border-b" style={{ borderColor: "#1e3a5f" }}>
                <div className="text-xs font-bold mb-2" style={{ color: "#64748b" }}>FILTER NODE TYPES</div>
                <div className="flex flex-wrap gap-1.5">
                  {FILTER_TYPES.map(({ key, label }) => {
                    const active = activeFilters.has(key);
                    const ns = NODE_STYLES[key];
                    return (
                      <button
                        key={key}
                        onClick={() => toggleFilter(key)}
                        className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg transition-all"
                        style={{ background: active ? ns.color + "33" : "#0f172a", color: active ? ns.color : "#475569", border: `1px solid ${active ? ns.color + "66" : "#1e3a5f"}` }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: active ? ns.color : "#475569" }} />
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between mt-3 mb-1">
                  <div className="text-xs font-bold" style={{ color: "#64748b" }}>MAX NODES</div>
                  <span className="text-xs font-bold" style={{ color: "#60a5fa" }}>{maxNodes}</span>
                </div>
                <input type="range" min={10} max={300} value={maxNodes} onChange={e => setMaxNodes(Number(e.target.value))} className="w-full accent-blue-500" />
                <div className="flex justify-between text-[10px] mt-0.5" style={{ color: "#334155" }}><span>10</span><span>300</span></div>
              </div>

              {/* Node detail */}
              {selectedNode && (
                <div className="p-4">
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
                        {selectedNode.actions.slice(0, 5).map(a => (<span key={a} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#1e3a5f", color: "#94a3b8" }}>{a}</span>))}
                      </div>
                    )}
                    {selectedNode.description && <p className="text-[11px] leading-relaxed" style={{ color: "#64748b" }}>{selectedNode.description}</p>}
                    {(selectedNode.nodeType === "drug_main" || selectedNode.nodeType === "drug_int") && (
                      <Link to={`/drugs/${selectedNode.nodeId}`} className="flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 rounded-lg" style={{ background: "#1e3a5f", color: "#60a5fa" }}>
                        <ExternalLink size={10} /> View full profile
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ============ GRAPH CANVAS ============ */}
            <div className="flex-1 relative">
              <div ref={graphContainerRef} className="w-full" style={{ height: "680px" }}>
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
                      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, Math.PI * 2); ctx.fill();
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
                    <div className="text-center space-y-4">
                      <div className="w-24 h-24 rounded-full flex items-center justify-center mx-auto" style={{ border: "2px dashed #1e3a5f" }}>
                        <Zap size={36} style={{ color: "#1e3a5f" }} />
                      </div>
                      <p className="font-bold text-lg" style={{ color: "#334155" }}>No Network Loaded</p>
                      <p className="text-sm max-w-xs" style={{ color: "#1e3a5f" }}>
                        ← Select a disease category, pick drugs from the list, then click <strong style={{ color: "#3b82f6" }}>Visualize Network</strong>
                      </p>
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

          {/* NETWORK SUMMARY */}
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
      </div>
    </div>
  );
}
