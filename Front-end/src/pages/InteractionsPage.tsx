import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Zap, Search, X, ChevronRight, AlertTriangle, AlertCircle,
  CheckCircle2, Database, Shield, Plus, Loader2, Info, ExternalLink,
  Save, Check, LogIn,
} from "lucide-react";
import { getDrugs } from "../lib/drugCache";
import { apiSearchDrugs } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// ─── TYPES ────────────────────────────────────────────────────────────────────
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

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const SVG_W = 720, SVG_H = 380;

const PROTEIN_POOL = [
  { id: "PTGS1",   t: "target"      }, { id: "PTGS2",   t: "target"      },
  { id: "CYP3A4",  t: "enzyme"      }, { id: "CYP2D6",  t: "enzyme"      },
  { id: "CYP2C9",  t: "enzyme"      }, { id: "CYP1A2",  t: "enzyme"      },
  { id: "CYP2E1",  t: "enzyme"      }, { id: "CYP2B6",  t: "enzyme"      },
  { id: "DRD2",    t: "target"      }, { id: "ADRB2",   t: "target"      },
  { id: "SLC22A1", t: "transporter" }, { id: "ABCB1",   t: "transporter" },
  { id: "HTR2A",   t: "target"      }, { id: "NR3C1",   t: "target"      },
  { id: "OPRD1",   t: "target"      }, { id: "MAOB",    t: "enzyme"      },
  { id: "P2071",   t: "target"      }, { id: "P1979",   t: "target"      },
  { id: "P2870",   t: "target"      }, { id: "P1082",   t: "target"      },
];

const DRUG_COLORS = [
  { g0: "#6366f1", g1: "#3730a3", s: "#818cf8" },
  { g0: "#f43f5e", g1: "#9f1239", s: "#fb7185" },
  { g0: "#10b981", g1: "#065f46", s: "#34d399" },
  { g0: "#f59e0b", g1: "#92400e", s: "#fbbf24" },
  { g0: "#8b5cf6", g1: "#4c1d95", s: "#a78bfa" },
  { g0: "#0ea5e9", g1: "#0c4a6e", s: "#38bdf8" },
  { g0: "#14b8a6", g1: "#134e4a", s: "#2dd4bf" },
  { g0: "#f97316", g1: "#7c2d12", s: "#fb923c" },
];

const SEV: Record<string, { line: string; bg: string; text: string; label: string }> = {
  major:    { line: "#ef4444", bg: "bg-red-50   border-red-100",   text: "text-red-700",   label: "High Risk" },
  moderate: { line: "#f59e0b", bg: "bg-amber-50 border-amber-100", text: "text-amber-700", label: "Moderate"  },
  minor:    { line: "#22c55e", bg: "bg-green-50 border-green-100", text: "text-green-700", label: "Low Risk"  },
  unknown:  { line: "#22c55e", bg: "bg-green-50 border-green-100", text: "text-green-700", label: "Low Risk"  },
};
// Helper: normalize raw severity → one of major | moderate | minor
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

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function getDrugPositions(count: number): { x: number; y: number }[] {
  const cx = SVG_W / 2, cy = SVG_H / 2;
  if (count === 0) return [];
  if (count === 1) return [{ x: cx, y: cy }];
  if (count === 2) return [{ x: cx - 155, y: cy }, { x: cx + 155, y: cy }];
  if (count === 3) return [
    { x: cx, y: cy - 105 }, { x: cx - 130, y: cy + 65 }, { x: cx + 130, y: cy + 65 },
  ];
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + 150 * Math.cos(a), y: cy + 115 * Math.sin(a) };
  });
}

function getDrugProteinNodes(drugId: string, approxCount: number) {
  let seed = (drugId.split("").reduce((a, c) => Math.imul(a, 31) + c.charCodeAt(0) | 0, 0)) >>> 0;
  const lcg = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  const n = Math.max(5, Math.min(8, approxCount || 6));
  const used = new Set<string>();
  return Array.from({ length: n }, (_, i) => {
    let idx = Math.floor(lcg() * PROTEIN_POOL.length);
    while (used.has(PROTEIN_POOL[idx].id)) idx = (idx + 1) % PROTEIN_POOL.length;
    used.add(PROTEIN_POOL[idx].id);
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2 + (lcg() - 0.5) * 0.7;
    const radius = 64 + Math.floor(lcg() * 3) * 14;
    return { id: PROTEIN_POOL[idx].id, t: PROTEIN_POOL[idx].t, angle, radius };
  });
}

// ─── DRUG NETWORK CANVAS ──────────────────────────────────────────────────────
interface CanvasProps {
  drugs: DrugEntry[];
  drugMeta: Map<string, { targets: number; enzymes: number }>;
  interactions: InteractionFound[];
  vizState: VizState;
  repelOffsets: Record<string, { dx: number; dy: number }>;
}

function DrugNetworkCanvas({ drugs, drugMeta, interactions, vizState, repelOffsets }: CanvasProps) {
  const positions = useMemo(() => getDrugPositions(drugs.length), [drugs.length]);
  const proteinNodes = useMemo(
    () => drugs.map(d => {
      const m = drugMeta.get(d.id) || { targets: 6, enzymes: 2 };
      return getDrugProteinNodes(d.id, m.targets + m.enzymes);
    }),
    [drugs, drugMeta],
  );
  const interactionMap = useMemo(() => {
    const m = new Map<string, InteractionFound>();
    interactions.forEach(r => m.set([r.drug_a_id, r.drug_b_id].sort().join("|"), r));
    return m;
  }, [interactions]);

  const isAnalyzing = vizState === "analyzing";
  const isDone = vizState === "done";

  const getActualPos = (drugId: string, base: { x: number; y: number }) => ({
    x: base.x + (repelOffsets[drugId]?.dx ?? 0),
    y: base.y + (repelOffsets[drugId]?.dy ?? 0),
  });

  return (
    <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full h-full" style={{ fontFamily: "system-ui,sans-serif" }}>
      <defs>
        <radialGradient id="cnvBg" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="#0d1b2e" />
          <stop offset="100%" stopColor="#020810" />
        </radialGradient>
        {drugs.map((_, i) => {
          const c = DRUG_COLORS[i % DRUG_COLORS.length];
          return (
            <linearGradient key={i} id={`dg${i}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={c.g0} />
              <stop offset="100%" stopColor={c.g1} />
            </linearGradient>
          );
        })}
        <filter id="fGlow">
          <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="b" />
          <feComposite in="SourceGraphic" in2="b" operator="over" />
        </filter>
        <filter id="fGlowSm">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="b" />
          <feComposite in="SourceGraphic" in2="b" operator="over" />
        </filter>
      </defs>

      {/* Background */}
      <rect width={SVG_W} height={SVG_H} fill="url(#cnvBg)" />

      {/* Dot grid */}
      {Array.from({ length: 14 }, (_, row) =>
        Array.from({ length: 25 }, (_, col) => (
          <circle key={`${row}-${col}`} cx={col * 30 + 15} cy={row * 28 + 12}
            r="0.9" fill="#1e3a5f" opacity="0.4" />
        ))
      )}

      {/* ── Interaction edges (shown when done) ── */}
      {isDone && drugs.flatMap((a, i) =>
        drugs.slice(i + 1).map((b, jOff) => {
          const j = i + 1 + jOff;
          const key = [a.id, b.id].sort().join("|");
          const ix = interactionMap.get(key);
          const posA = getActualPos(a.id, positions[i]);
          const posB = getActualPos(b.id, positions[j]);
          const color = ix ? (SEV[ix.severity]?.line ?? "#94a3b8") : "#22c55e";
          return (
            <g key={key}>
              {ix && (
                <line x1={posA.x} y1={posA.y} x2={posB.x} y2={posB.y}
                  stroke={color} strokeWidth="7" opacity="0.15" filter="url(#fGlow)" />
              )}
              <line x1={posA.x} y1={posA.y} x2={posB.x} y2={posB.y}
                stroke={color} strokeWidth={ix ? 2.2 : 1}
                strokeDasharray={ix ? undefined : "9,6"} opacity={ix ? 0.9 : 0.25} />
              {ix && (
                <circle cx={(posA.x + posB.x) / 2} cy={(posA.y + posB.y) / 2}
                  r="7" fill={color} filter="url(#fGlowSm)" opacity="0.9">
                  <animate attributeName="r" values="5;10;5" dur="2.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.7;1;0.7" dur="2.5s" repeatCount="indefinite" />
                </circle>
              )}
            </g>
          );
        })
      )}

      {/* ── Drug nodes ── */}
      {drugs.map((drug, i) => {
        const base = positions[i];
        const off = repelOffsets[drug.id] ?? { dx: 0, dy: 0 };
        const c = DRUG_COLORS[i % DRUG_COLORS.length];
        const nodes = proteinNodes[i] ?? [];

        return (
          <g key={drug.id}
            style={{
              transform: `translate(${off.dx}px, ${off.dy}px)`,
              transition: "transform 0.9s cubic-bezier(0.34,1.56,0.64,1)",
            }}>

            {/* Protein / enzyme nodes — orbital animation */}
            {nodes.map((node, ni) => {
              const nc = node.t === "enzyme" ? "#f59e0b"
                       : node.t === "transporter" ? "#14b8a6" : "#3b82f6";
              const startDeg = (node.angle * 180) / Math.PI;
              const durSec = 10 + ni * 2.6 + (i % 4) * 3.2;
              const dir = (i + ni) % 2 === 0 ? 1 : -1;
              return (
                <g key={ni} transform={`translate(${base.x},${base.y})`}>
                  {/* Faint orbit ring */}
                  <circle cx="0" cy="0" r={node.radius}
                    fill="none" stroke={nc} strokeWidth="0.3"
                    strokeDasharray="3,9" opacity="0.22" />
                  {/* Orbiting satellite group */}
                  <g>
                    <animateTransform
                      attributeName="transform"
                      attributeType="XML"
                      type="rotate"
                      from={`${startDeg} 0 0`}
                      to={`${startDeg + dir * 360} 0 0`}
                      dur={`${durSec}s`}
                      repeatCount="indefinite"
                    />
                    {/* Spoke line */}
                    <line x1="0" y1="0" x2={node.radius} y2="0"
                      stroke={nc} strokeWidth="0.7" strokeDasharray="4,4" opacity="0.28" />
                    {/* Glow halo (always pulsing) */}
                    <circle cx={node.radius} cy="0" r="10" fill={nc} opacity="0.1">
                      <animate attributeName="r" values="7;15;7"
                        dur={`${2.2 + ni * 0.4}s`} repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.06;0.22;0.06"
                        dur={`${2.2 + ni * 0.4}s`} repeatCount="indefinite" />
                    </circle>
                    {/* Node body */}
                    <circle cx={node.radius} cy="0" r="14"
                      fill="#060e1a" stroke={nc}
                      strokeWidth={isAnalyzing ? "2.4" : "1.7"} opacity="0.96">
                      <animate attributeName="stroke-width"
                        values={isAnalyzing ? "1.6;3;1.6" : "1.4;2;1.4"}
                        dur={`${1.8 + ni * 0.28}s`} repeatCount="indefinite" />
                    </circle>
                    {/* Node label */}
                    <text x={node.radius} y="4" textAnchor="middle"
                      fontSize="7.5" fill={nc} fontWeight="700">
                      {node.id}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* Idle glow + analyzing halo */}
            <ellipse cx={base.x} cy={base.y} rx="52" ry="28" fill={c.g0} opacity="0.1">
              <animate attributeName="rx" values={isAnalyzing ? "44;70;44" : "48;56;48"}
                dur={isAnalyzing ? "1.5s" : "3.5s"} repeatCount="indefinite" />
              <animate attributeName="opacity" values={isAnalyzing ? "0.12;0.38;0.12" : "0.06;0.16;0.06"}
                dur={isAnalyzing ? "1.5s" : "3.5s"} repeatCount="indefinite" />
            </ellipse>

            {/* Pill shadow */}
            <ellipse cx={base.x + 3} cy={base.y + 6} rx="46" ry="21" fill="#000" opacity="0.38">
              <animate attributeName="cy" values={`${base.y + 4};${base.y + 8};${base.y + 4}`}
                dur="3.5s" repeatCount="indefinite" />
            </ellipse>

            {/* Pill body */}
            <rect x={base.x - 46} y={base.y - 21} width="92" height="42" rx="21" ry="21"
              fill={`url(#dg${i})`} stroke={c.s} strokeWidth="1.8">
              {isAnalyzing && (
                <animate attributeName="stroke-opacity" values="0.35;1;0.35" dur="1.3s" repeatCount="indefinite" />
              )}
            </rect>

            {/* Glossy highlight */}
            <ellipse cx={base.x - 7} cy={base.y - 9} rx="28" ry="9" fill="white" opacity="0.14" />
            <ellipse cx={base.x - 7} cy={base.y - 9} rx="15" ry="5" fill="white" opacity="0.08" />

            {/* Drug name */}
            <text x={base.x} y={base.y + 5} textAnchor="middle" fontSize="10.5"
              fill="white" fontWeight="700" letterSpacing="-0.3">
              {drug.name.length > 12 ? drug.name.substring(0, 11) + "\u2026" : drug.name}
            </text>

            {/* ID badge */}
            <rect x={base.x - 23} y={base.y + 14} width="46" height="12" rx="6" fill="#000" opacity="0.42" />
            <text x={base.x} y={base.y + 23} textAnchor="middle" fontSize="7.5" fill={c.s} fontWeight="600">
              {drug.id}
            </text>
          </g>
        );
      })}

      {/* Empty state */}
      {drugs.length === 0 && (
        <g>
          <circle cx={SVG_W / 2} cy={SVG_H / 2} r="64" fill="none" stroke="#1e3a5f" strokeWidth="1"
            strokeDasharray="8,6" opacity="0.5" />
          <circle cx={SVG_W / 2} cy={SVG_H / 2} r="105" fill="none" stroke="#1e3a5f" strokeWidth="0.5"
            strokeDasharray="6,8" opacity="0.3" />
          <text x={SVG_W / 2} y={SVG_H / 2 - 14} textAnchor="middle" fontSize="13.5" fill="#334155" fontWeight="600">
            Select drugs from the left panel
          </text>
          <text x={SVG_W / 2} y={SVG_H / 2 + 8} textAnchor="middle" fontSize="10.5" fill="#475569">
            to visualize molecular interaction networks
          </text>
        </g>
      )}

      {/* Legend */}
      {[
        { c: "#3b82f6", l: "Target" }, { c: "#f59e0b", l: "Enzyme" },
        { c: "#14b8a6", l: "Transporter" }, { c: "#ef4444", l: "High Risk" }, { c: "#22c55e", l: "Safe" },
      ].map(({ c: col, l }, i) => (
        <g key={l} transform={`translate(${14 + i * 90}, ${SVG_H - 18})`}>
          <circle cx="5" cy="4" r="4" fill={col} />
          <text x="13" y="8" fontSize="9" fill="#64748b">{l}</text>
        </g>
      ))}

      {/* Status caption */}
      <text x={SVG_W - 10} y={SVG_H - 8} textAnchor="end" fontSize="8.5" fill="#334155">
        {isAnalyzing ? "\u25CF Analyzing interactions\u2026" : "Molecular collision simulation \u00B7 Cinematic"}
      </text>
    </svg>
  );
}

// ─── INTERACTION DETAIL MODAL ─────────────────────────────────────────────────
function InteractionModal({ ix, onClose }: { ix: InteractionFound | null; onClose: () => void }) {
  if (!ix) return null;
  const sev = SEV[normSev(ix.severity)];
  const rec = RECOMMENDATION[normSev(ix.severity)];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
          <div className="flex items-center gap-2 font-bold text-gray-800">
            <AlertTriangle size={16} className="text-amber-500" /> Interaction Details
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors rounded-lg p-1 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pt-5 pb-4 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Drug pair visual */}
          <div className="flex items-center justify-center gap-4 p-4 bg-gradient-to-br from-slate-50 to-blue-50/50 rounded-xl border border-gray-100">
            <div className="flex flex-col items-center gap-2">
              <div className="w-[72px] h-[36px] rounded-full bg-gradient-to-br from-indigo-500 to-indigo-800 flex items-center justify-center shadow-md">
                <span className="text-[9px] text-white font-bold text-center leading-tight px-1">
                  {ix.drug_a_name.length > 9 ? ix.drug_a_name.substring(0, 8) + "\u2026" : ix.drug_a_name}
                </span>
              </div>
              <span className="text-xs font-semibold text-gray-700 max-w-[90px] text-center leading-snug">
                {ix.drug_a_name}
              </span>
            </div>

            <div className="flex flex-col items-center gap-1.5">
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${sev.bg} ${sev.text}`}>
                &#9888; {sev.label} &middot; {ix.source || "DrugBank"}
              </span>
              <ChevronRight size={18} className="text-gray-400" />
            </div>

            <div className="flex flex-col items-center gap-2">
              <div className="w-[72px] h-[36px] rounded-full bg-gradient-to-br from-rose-500 to-rose-800 flex items-center justify-center shadow-md">
                <span className="text-[9px] text-white font-bold text-center leading-tight px-1">
                  {ix.drug_b_name.length > 9 ? ix.drug_b_name.substring(0, 8) + "\u2026" : ix.drug_b_name}
                </span>
              </div>
              <span className="text-xs font-semibold text-gray-700 max-w-[90px] text-center leading-snug">
                {ix.drug_b_name}
              </span>
            </div>
          </div>

          {/* Interaction type */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Interaction Type / Mechanism
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-700">
                DRUGBANK DIRECT
              </span>
            </div>
            <p className="text-sm font-semibold text-gray-800 leading-snug">
              {ix.description.split(".")[0] || "Drug\u2013Drug Interaction"}
            </p>
          </div>

          {/* Clinical impact */}
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              &#9900; Clinical Impact
            </div>
            <p className="text-sm text-gray-700 leading-relaxed bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
              {ix.description || "No detailed information available."}
            </p>
          </div>

          {/* Clinical recommendation */}
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              &#10003; Clinical Recommendation
            </div>
            <div className="flex items-start gap-2 bg-blue-50 rounded-xl px-3 py-2.5 border border-blue-100">
              <Info size={14} className="text-blue-500 mt-0.5 shrink-0" />
              <p className="text-sm text-blue-800 leading-relaxed">{rec}</p>
            </div>
          </div>

          {/* Disclaimer */}
          <div className="flex items-start gap-2 bg-amber-50 rounded-xl px-3 py-2 border border-amber-100">
            <AlertTriangle size={12} className="text-amber-500 mt-0.5 shrink-0" />
            <p className="text-[11px] text-amber-800 leading-snug">
              Always consult a licensed healthcare professional before making clinical decisions based on this information.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-[10px] text-gray-400">Data source: DrugBank v5 &middot; 2026</span>
          <button onClick={onClose}
            className="text-primary-600 hover:text-primary-800 font-semibold text-xs transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function InteractionsPage() {
  const { user, token } = useAuth();
  const [categories, setCategories] = useState<DrugCategory[]>([]);
  const [catLoading, setCatLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedDrugs, setSelectedDrugs] = useState<DrugEntry[]>([]);
  const [drugSearch, setDrugSearch] = useState("");
  const [drugSuggestions, setDrugSuggestions] = useState<DrugEntry[]>([]);
  const [drugMeta, setDrugMeta] = useState<Map<string, { targets: number; enzymes: number }>>(new Map());

  // Interaction check state
  const [vizState, setVizState] = useState<VizState>("idle");
  const [interactions, setInteractions] = useState<InteractionFound[]>([]);
  const [repelOffsets, setRepelOffsets] = useState<Record<string, { dx: number; dy: number }>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [modalIx, setModalIx] = useState<InteractionFound | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "guest">("idle");
  const [restored, setRestored] = useState(false);

  // Restore last session: from API (if logged in) or sessionStorage (if guest)
  useEffect(() => {
    if (token) {
      // Logged in — restore from API
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
        .catch(() => {/* backend offline — skip restore */});
    } else {
      // Guest — restore from sessionStorage (only within current tab)
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

  // Load drug meta for network visualization (lazy background load)
  // Local drug list for fallback search
  const [localDrugs, setLocalDrugs] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    getDrugs().then(drugs => {
      setDrugMeta(new Map(drugs.map(d => [d.id, {
        targets: (d.targets as unknown as number) || 5,
        enzymes: (d.enzymes as unknown as number) || 2,
      }])));
      if (drugs.length > 0) {
        setLocalDrugs(drugs.map(d => ({ id: d.id, name: d.name })));
      }
    });
    // Also preload from public JSON as fallback
    fetch(`${import.meta.env.BASE_URL}data/drugs.json`)
      .then(r => r.json())
      .then((data: { id: string; name: string }[]) => {
        setLocalDrugs(prev => prev.length > 0 ? prev : data.map(d => ({ id: d.id, name: d.name })));
      })
      .catch(() => {});
  }, []);

  // Autocomplete — API first, fallback to local
  useEffect(() => {
    if (drugSearch.length < 2) { setDrugSuggestions([]); return; }
    const controller = new AbortController();
    const q = drugSearch.toLowerCase();
    apiSearchDrugs(drugSearch, controller.signal)
      .then(results => {
        if (results.length > 0) {
          setDrugSuggestions(
            results.filter(d => !selectedDrugs.find(s => s.id === d.id)).slice(0, 8)
          );
        } else {
          // Fallback: search local drugs.json
          const local = localDrugs
            .filter(d => d.name.toLowerCase().includes(q) && !selectedDrugs.find(s => s.id === d.id))
            .slice(0, 8);
          setDrugSuggestions(local);
        }
      })
      .catch(() => {
        // API failed — use local fallback
        const local = localDrugs
          .filter(d => d.name.toLowerCase().includes(q) && !selectedDrugs.find(s => s.id === d.id))
          .slice(0, 8);
        setDrugSuggestions(local);
      });
    return () => controller.abort();
  }, [drugSearch, selectedDrugs, localDrugs]);

  const resetViz = useCallback(() => {
    setVizState("idle"); setInteractions([]); setRepelOffsets({}); setApiError(null);
  }, []);

  const clearAll = useCallback(() => {
    setSelectedDrugs([]);
    setDrugSearch(""); setDrugSuggestions([]);
    setVizState("idle"); setInteractions([]); setRepelOffsets({}); setApiError(null); setRestored(false);
  }, []);

  const addDrug = useCallback((drug: DrugEntry) => {
    if (selectedDrugs.length >= 8 || selectedDrugs.find(s => s.id === drug.id)) return;
    setSelectedDrugs(prev => [...prev, drug]);
    setDrugSearch(""); setDrugSuggestions([]);
    setVizState("idle"); setInteractions([]); setRepelOffsets({}); setApiError(null);
  }, [selectedDrugs]);

  const removeDrug = useCallback((id: string) => {
    setSelectedDrugs(prev => prev.filter(d => d.id !== id));
    resetViz();
  }, [resetViz]);

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
        if (typeof detail === 'string') {
          message = detail;
        } else if (detail && typeof detail === 'object' && 'message' in detail) {
          message = (detail as { message: string }).message;
        } else if (Array.isArray(detail) && detail.length > 0 && (detail[0] as { msg?: string }).msg) {
          message = (detail as { msg: string }[]).map(d => d.msg).join(', ');
        } else {
          message = `HTTP ${res.status}`;
        }
        throw new Error(message);
      }
      const data: CheckResponse = await res.json();
      const found = data.interactions_found ?? [];
      setInteractions(found);

      // Calculate repel offsets
      const positions = getDrugPositions(selectedDrugs.length);
      const offsets: Record<string, { dx: number; dy: number }> = {};
      if (found.length > 0) {
        selectedDrugs.forEach((drug, i) => {
          let dx = 0, dy = 0;
          found.forEach(r => {
            if (r.drug_a_id === drug.id || r.drug_b_id === drug.id) {
              const otherId = r.drug_a_id === drug.id ? r.drug_b_id : r.drug_a_id;
              const oi = selectedDrugs.findIndex(d => d.id === otherId);
              if (oi >= 0) {
                const pi = positions[i], po = positions[oi];
                const len = Math.hypot(pi.x - po.x, pi.y - po.y) || 1;
                dx += ((pi.x - po.x) / len) * 40;
                dy += ((pi.y - po.y) / len) * 28;
              }
            }
          });
          if (dx !== 0 || dy !== 0) offsets[drug.id] = { dx, dy };
        });
      }
      setRepelOffsets(offsets);
      setVizState("done");
      // Auto-save to DB immediately after every successful check
      autoSave(selectedDrugs, found);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to connect. Is the backend running on port 8000?");
      setVizState("idle");
    }
  }, [selectedDrugs]);

  // Auto-save session: DB (logged in) or sessionStorage (guest)
  const autoSave = useCallback(async (drugs: DrugEntry[], found: InteractionFound[]) => {
    if (drugs.length < 2) return;

    if (!token) {
      // Guest — save to sessionStorage only (cleared on page close/reload)
      try {
        sessionStorage.setItem("medidb_guest_session", JSON.stringify({
          drugs_snapshot: drugs,
          interactions_found: found,
        }));
      } catch { /* ignore quota errors */ }
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
        total_drugs: drugs.length,
        total_interactions: found.length,
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
    } catch {
      setSaveState("idle"); // silent fail — user not blocked
    }
  }, [token]);

  // Derived stats — unknown maps to low risk
  const highCount = interactions.filter(r => normSev(r.severity) === "major").length;
  const modCount  = interactions.filter(r => normSev(r.severity) === "moderate").length;
  const lowCount  = interactions.filter(r => normSev(r.severity) === "minor").length;

  const allPairs = useMemo(() => {
    if (vizState !== "done") return [];
    return selectedDrugs.flatMap((a, i) =>
      selectedDrugs.slice(i + 1).map(b => ({
        a, b,
        ix: interactions.find(r =>
          (r.drug_a_id === a.id && r.drug_b_id === b.id) ||
          (r.drug_a_id === b.id && r.drug_b_id === a.id)
        ) ?? null,
      }))
    );
  }, [vizState, selectedDrugs, interactions]);

  const activeCat = categories.find(c => c.key === activeCategory);
  const catDrugsFiltered = activeCat
    ? activeCat.drugs.filter(d => !drugSearch || d.name.toLowerCase().includes(drugSearch.toLowerCase()))
    : [];
  const cc = (col: string) => CAT_COLORS[col] ?? CAT_COLORS.blue;

  return (
    <>
      <InteractionModal ix={modalIx} onClose={() => setModalIx(null)} />
      <div className="min-h-screen bg-gray-50">

        {/* ── PAGE HEADER ─────────────────────────────── */}
        <div className="bg-gradient-to-r from-primary-950 via-primary-900 to-primary-800 text-white pt-8 pb-10">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-center gap-2 text-blue-300 text-sm mb-4">
              <Link to="/" className="hover:text-white transition-colors">Home</Link>
              <ChevronRight size={14} />
              <span className="text-white font-medium">Drug Interaction Checker</span>
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
                  Interaction detection based on molecular network &middot; 24,386 interaction pairs from DrugBank
                  &middot; 33 class-based rules &middot; 3D drug-protein interaction simulation
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-emerald-300 bg-emerald-900/30 border border-emerald-700/40 px-3 py-1.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                DrugBank Data &middot; 2026
              </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "SELECTED DRUGS",     val: selectedDrugs.length,     icon: "💊", cls: "from-red-900/60    to-red-800/40    border-red-700/40"     },
                { label: "BIOLOGICAL TARGETS", val: selectedDrugs.length * 3, icon: "🧬", cls: "from-violet-900/60 to-violet-800/40 border-violet-700/40" },
                { label: "RELATED ENZYMES",    val: selectedDrugs.length * 2, icon: "⚗️",  cls: "from-amber-900/60  to-amber-800/40  border-amber-700/40"  },
                { label: "INTERACTIONS FOUND", val: interactions.length,       icon: "✅", cls: "from-emerald-900/60 to-emerald-800/40 border-emerald-700/40" },
              ].map(s => (
                <div key={s.label} className={`rounded-2xl border p-4 bg-gradient-to-br ${s.cls}`}>
                  <div className="text-[10px] font-bold text-gray-400 tracking-widest mb-1">{s.label}</div>
                  <div className="flex items-end justify-between">
                    <span className="text-4xl font-extrabold text-white">{s.val}</span>
                    <span className="text-2xl mb-1">{s.icon}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── 3-COLUMN BODY ────────────────────────────── */}
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="grid lg:grid-cols-[300px_1fr_280px] gap-5">

            {/* ── LEFT: Drug Selector ────────── */}
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-gray-800 text-sm">
                    <Search size={15} className="text-gray-400" /> Select Drugs
                  </div>
                  {selectedDrugs.length > 0 && (
                    <span className="bg-primary-100 text-primary-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                      {selectedDrugs.length} selected
                    </span>
                  )}
                </div>

                {/* Category list */}
                <div className="p-3 space-y-1 max-h-64 overflow-y-auto">
                  {catLoading
                    ? <div className="flex items-center justify-center py-5 text-gray-400 text-xs">
                        <Loader2 size={14} className="animate-spin mr-2" /> Loading&hellip;
                      </div>
                    : categories.map(cat => {
                        const isActive = activeCategory === cat.key;
                        const cols = cc(cat.color);
                        return (
                          <button key={cat.key}
                            onClick={() => setActiveCategory(isActive ? null : cat.key)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-sm font-medium transition-all ${isActive ? `${cols.bg} ${cols.tx} ring-1 ${cols.rg}` : "text-gray-700 hover:bg-gray-50"}`}>
                            <span className="text-base shrink-0">{cat.icon}</span>
                            <span className="flex-1 truncate">{cat.label}</span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isActive ? `bg-white/60 ${cols.tx}` : "bg-gray-100 text-gray-400"}`}>
                              {cat.count}
                            </span>
                          </button>
                        );
                      })}
                </div>

                {/* Drug search input */}
                <div className="border-t border-gray-100 p-3 relative">
                  <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2 border border-gray-200 focus-within:border-primary-300 focus-within:bg-white transition-all">
                    <Search size={13} className="text-gray-400 shrink-0" />
                    <input type="text" value={drugSearch} onChange={e => setDrugSearch(e.target.value)}
                      placeholder="Search drugs&hellip;"
                      className="flex-1 text-xs bg-transparent outline-none text-gray-700 placeholder-gray-400"
                      onKeyDown={e => {
                        if (e.key === 'Enter' && drugSuggestions.length > 0) {
                          e.preventDefault();
                          addDrug(drugSuggestions[0]);
                        }
                      }} />
                    {drugSearch && (
                      <button onClick={() => { setDrugSearch(""); setDrugSuggestions([]); }}>
                        <X size={12} className="text-gray-400" />
                      </button>
                    )}
                  </div>

                  {/* Autocomplete dropdown */}
                  {drugSuggestions.length > 0 && (
                    <div className="absolute left-3 right-3 top-full mt-1 bg-white rounded-xl border border-gray-200 shadow-lg z-20 overflow-hidden">
                      {drugSuggestions.map(d => (
                        <button key={d.id} onClick={() => addDrug(d)}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-primary-50 transition-colors text-left">
                          <Plus size={11} className="text-primary-400 shrink-0" />
                          <span className="text-xs font-medium text-gray-800 truncate">{d.name}</span>
                          <span className="text-[9px] text-gray-400 font-mono shrink-0">{d.id}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Drugs from active category */}
                  {activeCat && catDrugsFiltered.length > 0 && !drugSearch && (
                    <div className="mt-2 space-y-0.5 max-h-52 overflow-y-auto">
                      {catDrugsFiltered.map(drug => {
                        const isSel = !!selectedDrugs.find(s => s.id === drug.id);
                        return (
                          <button key={drug.id}
                            onClick={() => isSel ? removeDrug(drug.id) : addDrug(drug)}
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
                  )}
                </div>
              </div>

              {/* Selected drug chips */}
              {selectedDrugs.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      Selected ({selectedDrugs.length}/8)
                    </div>
                    <button
                      onClick={clearAll}
                      className="flex items-center gap-1 text-[10px] font-semibold text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-0.5 rounded-lg transition-colors border border-red-100 hover:border-red-200"
                    >
                      <X size={9} /> Đặt lại
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedDrugs.map((d, i) => (
                      <div key={d.id}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium border"
                        style={{
                          background: DRUG_COLORS[i % DRUG_COLORS.length].g1 + "22",
                          borderColor: DRUG_COLORS[i % DRUG_COLORS.length].s + "55",
                          color: DRUG_COLORS[i % DRUG_COLORS.length].s,
                        }}>
                        <span className="truncate max-w-[100px]">{d.name}</span>
                        <button onClick={() => removeDrug(d.id)} className="opacity-70 hover:opacity-100 ml-0.5">
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick add */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5">Quick Add</div>
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
                        {isSel && <span className="mr-0.5">&#10003;</span>}{d.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ── CENTER: Visualization + Results ── */}
            <div className="space-y-4">
              {/* SVG canvas */}
              <div className="bg-gradient-to-br from-slate-950 to-slate-900 rounded-2xl border border-slate-700/50 shadow-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-700/40 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-300 text-xs font-semibold">
                    <Zap size={13} className="text-amber-400" />
                    Drug Interaction Network
                    {vizState === "analyzing" && (
                      <span className="text-amber-300 animate-pulse ml-1">&middot; Analyzing&hellip;</span>
                    )}
                    {vizState === "done" && interactions.length > 0 && (
                      <span className="text-red-400 ml-1">&middot; {interactions.length} interaction{interactions.length !== 1 ? "s" : ""} found</span>
                    )}
                    {vizState === "done" && interactions.length === 0 && (
                      <span className="text-emerald-400 ml-1">&middot; No interactions found</span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500">Molecular collision simulation &middot; Cinematic</span>
                </div>
                <div className="h-[340px]">
                  <DrugNetworkCanvas
                    drugs={selectedDrugs}
                    drugMeta={drugMeta}
                    interactions={interactions}
                    vizState={vizState}
                    repelOffsets={repelOffsets}
                  />
                </div>
              </div>

              {/* Error banner */}
              {apiError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-100 text-red-700 text-xs px-4 py-3 rounded-xl">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>{apiError}</span>
                </div>
              )}

              {/* Analysis results panel */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
                <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-gray-800 text-sm">
                    <Zap size={15} className="text-primary-600" /> Analysis Results
                  </div>
                  <div className="flex items-center gap-2">
                    {vizState === "done" && (
                      <span className="text-xs text-gray-500 font-medium">
                        {interactions.length} / {allPairs.length} pair{allPairs.length !== 1 ? "s" : ""}
                      </span>
                    )}
                    <span className="text-[10px] text-gray-400 italic">Source: DrugBank</span>
                  </div>
                </div>

                {selectedDrugs.length < 2 ? (
                  <div className="px-5 py-10 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-gray-50 border border-dashed border-gray-200 flex items-center justify-center mx-auto mb-3">
                      <Zap size={24} className="text-gray-300" />
                    </div>
                    <p className="font-bold text-gray-400 text-sm mb-1">No interactions to display</p>
                    <p className="text-gray-400 text-xs">Add 2&ndash;8 drugs to detect interactions.</p>
                  </div>
                ) : vizState !== "done" ? (
                  <div className="px-5 py-8 text-center">
                    <button onClick={checkInteractions} disabled={vizState === "analyzing"}
                      className="inline-flex items-center gap-2 bg-primary-800 hover:bg-primary-700 disabled:opacity-60 text-white px-8 py-3 rounded-xl font-bold text-sm transition-colors shadow-lg">
                      {vizState === "analyzing"
                        ? <><Loader2 size={16} className="animate-spin" /> Analyzing {selectedDrugs.length} drugs&hellip;</>
                        : <><Zap size={16} className="text-amber-300" /> Check Interactions ({selectedDrugs.length} drugs)</>
                      }
                    </button>
                    <p className="text-gray-400 text-xs mt-3">
                      Will check {Math.floor(selectedDrugs.length * (selectedDrugs.length - 1) / 2)} pair{selectedDrugs.length > 2 ? "s" : ""} &middot; Source: DrugBank v5
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {/* Restored session banner */}
                    {restored && (
                      <div className="px-5 py-2.5 flex items-center justify-between bg-indigo-50 border-b border-indigo-100">
                        <span className="text-xs text-indigo-700 flex items-center gap-1.5">
                          <Check size={11} className="text-indigo-500" />
                          Đã khôi phục phiên làm việc trước — dữ liệu lưu từ lần kiểm tra gần nhất
                        </span>
                        <button onClick={() => setRestored(false)} className="text-indigo-400 hover:text-indigo-700">
                          <X size={12} />
                        </button>
                      </div>
                    )}
                    {allPairs.map(({ a, b, ix }) => {
                      const s = ix ? SEV[normSev(ix.severity)] : null;
                      return (
                        <div key={`${a.id}-${b.id}`}
                          className={`px-5 py-3.5 ${ix ? "cursor-pointer hover:bg-gray-50 transition-colors" : ""}`}
                          onClick={() => ix && setModalIx(ix)}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-semibold text-sm text-gray-800 truncate max-w-[130px]">{a.name}</span>
                              <ChevronRight size={13} className="text-gray-300 shrink-0" />
                              <span className="font-semibold text-sm text-gray-800 truncate max-w-[130px]">{b.name}</span>
                            </div>
                            {ix && s ? (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${s.bg} ${s.text}`}>
                                  &#9888; {s.label}
                                </span>
                                <ExternalLink size={11} className="text-gray-400" />
                              </div>
                            ) : (
                              <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full shrink-0 whitespace-nowrap">
                                &#10003; No interaction
                              </span>
                            )}
                          </div>
                          {ix?.description && (
                            <p className="text-xs text-gray-500 mt-1.5 leading-relaxed line-clamp-2 pl-0.5">
                              {ix.description}
                            </p>
                          )}
                        </div>
                      );
                    })}
                    {/* re-check + auto-save indicator */}
                    <div className="px-5 py-3 flex items-center justify-between">
                      <button onClick={() => { setVizState("idle"); setInteractions([]); setRepelOffsets({}); setRestored(false); }}
                        className="text-xs text-primary-600 hover:text-primary-800 font-semibold transition-colors">
                        Clear &amp; re-check
                      </button>
                      <div className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg ${
                        saveState === "saved"  ? "text-green-700 bg-green-50 border border-green-200"
                        : saveState === "saving" ? "text-amber-600 bg-amber-50 border border-amber-200"
                        : saveState === "guest" ? "text-orange-600 bg-orange-50 border border-orange-200"
                        : "text-gray-400"
                      }`}>
                        {saveState === "saving" ? <><Loader2 size={12} className="animate-spin" /> Đang lưu...</>
                          : saveState === "saved" ? <><Check size={12} /> Đã lưu vào phân tích</>
                          : saveState === "guest" ? <><LogIn size={12} /> Đăng nhập để lưu lịch sử</>
                          : <><Save size={11} className="opacity-40" /> Tự động lưu</>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── RIGHT: Stats & Info ─────────── */}
            <div className="space-y-4">
              {/* Analyze button (right panel shortcut) */}
              {selectedDrugs.length >= 2 && vizState !== "done" && (
                <button onClick={checkInteractions} disabled={vizState === "analyzing"}
                  className="w-full flex items-center justify-center gap-2 bg-primary-800 hover:bg-primary-700 disabled:opacity-60 text-white px-4 py-3 rounded-xl font-bold text-sm transition-colors shadow-md">
                  {vizState === "analyzing"
                    ? <><Loader2 size={15} className="animate-spin" /> Analyzing&hellip;</>
                    : <><Zap size={15} className="text-amber-300" /> Analyze Interactions</>}
                </button>
              )}

              {/* Risk Overview */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center gap-2 font-bold text-gray-800 text-sm mb-4">
                  <AlertTriangle size={15} className="text-amber-500" /> Risk Overview
                </div>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="border border-red-100 bg-red-50 rounded-xl p-3 text-center">
                    <div className="text-red-600 text-2xl font-extrabold">{highCount}</div>
                    <div className="text-[9px] font-bold text-gray-400 tracking-widest mt-0.5">HIGH</div>
                  </div>
                  <div className="border border-amber-100 bg-amber-50 rounded-xl p-3 text-center">
                    <div className="text-amber-600 text-2xl font-extrabold">{modCount}</div>
                    <div className="text-[9px] font-bold text-gray-400 tracking-widest mt-0.5">MODERATE</div>
                  </div>
                  <div className="border border-green-100 bg-green-50 rounded-xl p-3 text-center">
                    <div className="text-green-600 text-2xl font-extrabold">{lowCount}</div>
                    <div className="text-[9px] font-bold text-gray-400 tracking-widest mt-0.5">LOW</div>
                  </div>
                </div>
                <div className="space-y-2">
                  {[
                    { label: "High Risk", count: highCount, bar: "bg-red-500"   },
                    { label: "Moderate",  count: modCount,  bar: "bg-amber-400" },
                    { label: "Low Risk",  count: lowCount,  bar: "bg-green-500" },
                  ].map(r => {
                    const max = Math.max(highCount, modCount, lowCount, 1);
                    return (
                      <div key={r.label} className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 w-20 shrink-0">{r.label}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                          <div className={`h-full rounded-full transition-all duration-700 ${r.bar}`}
                            style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
                        </div>
                        <span className="text-xs font-bold text-gray-600 w-4 text-right">{r.count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Database stats */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center gap-2 font-bold text-gray-800 text-sm mb-4">
                  <Database size={15} className="text-primary-600" /> Database
                </div>
                <div className="space-y-2.5 text-xs">
                  {[
                    { label: "Total drugs",        val: "17,590"       },
                    { label: "Interaction pairs",  val: "24,386"       },
                    { label: "Classified drugs",   val: "589"          },
                    { label: "Class-based rules",  val: "33"           },
                    { label: "Source",             val: "DrugBank v5", mono: true },
                  ].map(item => (
                    <div key={item.label} className="flex justify-between items-center">
                      <span className="text-gray-500">{item.label}</span>
                      <span className={`font-semibold text-gray-800 ${item.mono ? "font-mono text-primary-700" : ""}`}>{item.val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Severity classification */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center gap-2 font-bold text-gray-800 text-sm mb-4">
                  <Shield size={15} className="text-primary-600" /> Severity Classification
                </div>
                <div className="space-y-3">
                  {[
                    { icon: <AlertTriangle size={14} className="text-red-500" />,    label: "High Risk",  cls: "bg-red-50   border-red-100",    tx: "text-red-600",   desc: "Avoid combination or monitor closely" },
                    { icon: <AlertCircle   size={14} className="text-amber-500" />,  label: "Moderate",   cls: "bg-amber-50 border-amber-100",  tx: "text-amber-700", desc: "Usable, dose adjustment may be needed" },
                    { icon: <CheckCircle2  size={14} className="text-green-500" />,  label: "Low Risk",   cls: "bg-green-50 border-green-100",  tx: "text-green-700", desc: "Minor interaction, routine monitoring" },
                  ].map(s => (
                    <div key={s.label} className={`flex items-start gap-2.5 p-3 rounded-xl border ${s.cls}`}>
                      <div className="mt-0.5 shrink-0">{s.icon}</div>
                      <div>
                        <div className={`text-xs font-bold ${s.tx}`}>{s.label}</div>
                        <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">{s.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}