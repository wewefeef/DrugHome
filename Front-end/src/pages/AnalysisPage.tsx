import { useState, useEffect, useCallback } from 'react';
import { apiFetchDrugInteractions } from '../lib/api';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  BarChart2, ChevronRight, X, Zap, AlertTriangle, CheckCircle2,
  Info, Clock, Trash2, Tag, FileText, Search, TrendingUp, Shield,
  Pill, FlaskConical, Activity, Edit3, Save,
  RefreshCw, Database, Star, ArrowRight, LayoutDashboard, LogIn,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

interface DrugSnap { id: string; name: string; }
interface InteractionRec {
  drug_a_id: string; drug_a_name: string;
  drug_b_id: string; drug_b_name: string;
  severity: string; description: string; source: string;
}
interface Session {
  id: number;
  title: string;
  tags: string | null;
  total_drugs: number;
  total_interactions: number;
  major_count: number;
  moderate_count: number;
  minor_count: number;
  risk_score: number | null;
  risk_level: string | null;
  drugs_snapshot: DrugSnap[] | null;
  interactions_found: InteractionRec[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
interface Stats {
  total_sessions: number;
  total_interactions_checked: number;
  total_major: number;
  total_moderate: number;
  total_minor: number;
  most_checked_drugs: { name: string; count: number }[];
  sessions_by_month: { month: string; count: number }[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

const SEV = {
  major:    { bg: 'bg-red-50 border-red-200',    text: 'text-red-700',    dot: 'bg-red-500',    label: 'High Risk' },
  moderate: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700',  dot: 'bg-amber-400',  label: 'Moderate' },
  minor:    { bg: 'bg-green-50 border-green-200', text: 'text-green-700',  dot: 'bg-green-500',  label: 'Low' },
  unknown:  { bg: 'bg-green-50 border-green-200', text: 'text-green-700',  dot: 'bg-green-500',  label: 'Low' },
};
const normSev = (s: string) => (['major','moderate','minor'].includes(s) ? s as keyof typeof SEV : 'minor');

// ── Interaction pathway analysis ───────────────────────────────────────────

interface PathwayInfo {
  mechanism: string;
  effect: string;
  recommendation: string;
  category: string;
  interactionType: 'PK' | 'PD';
}

function parsePathway(ix: InteractionRec): PathwayInfo {
  const d = (ix.description || '').toLowerCase();

  if (d.includes('seroton'))
    return { mechanism: 'Serotonin Syndrome', effect: 'Elevated serotonin — toxicity', recommendation: 'Avoid concurrent use. Life-threatening risk.', category: 'serotonin', interactionType: 'PD' };
  if (d.includes('qt prolongat') || d.includes('torsade') || d.includes('arrhythmia') || d.includes('cardiac arrhyth'))
    return { mechanism: 'QT interval prolongation', effect: 'Arrhythmia / Torsades de Pointes', recommendation: 'Monitor ECG. Avoid combination if possible.', category: 'cardiac', interactionType: 'PD' };
  if (d.includes('bleeding') || d.includes('hemorrhag') || d.includes('anticoagulant effect') || d.includes('risk of bleeding'))
    return { mechanism: 'Enhanced anticoagulant activity', effect: 'Risk of serious bleeding', recommendation: 'Monitor INR, PT/aPTT. Adjust anticoagulant dose.', category: 'bleeding', interactionType: 'PD' };
  if (d.includes('nephrotox') || d.includes('renal toxicity') || d.includes('acute kidney'))
    return { mechanism: 'Additive nephrotoxicity', effect: 'Increased risk of acute kidney injury', recommendation: 'Monitor creatinine/GFR. Adjust dose per renal function.', category: 'renal', interactionType: 'PD' };
  if (d.includes('hepatotox') || d.includes('liver toxicity') || d.includes('hepatic'))
    return { mechanism: 'Additive hepatotoxicity', effect: 'Hepatocellular damage', recommendation: 'Monitor liver enzymes (ALT/AST). Consider alternative.', category: 'hepatic', interactionType: 'PD' };
  if (d.includes('cns depression') || d.includes('sedation') || d.includes('respiratory depression'))
    return { mechanism: 'CNS depression', effect: 'Deep sedation / respiratory depression', recommendation: 'Reduce dose. Monitor consciousness and respiration closely.', category: 'cns', interactionType: 'PD' };
  if (d.includes('cyp') || d.includes('metabolism of') || d.includes('metabolized by') || d.includes('cytochrome')) {
    const isDecreased = d.includes('decreased') || d.includes('inhibit') || d.includes('reduced');
    return {
      mechanism: 'CYP450 enzyme inhibition/induction',
      effect: isDecreased ? 'Increased plasma drug concentration' : 'Decreased plasma drug concentration',
      recommendation: isDecreased ? 'Reduce dose and monitor plasma drug levels.' : 'Increase dose and monitor therapeutic effect.',
      category: 'metabolic', interactionType: 'PK',
    };
  }
  if (d.includes('serum concentration') || d.includes('plasma concentration') || d.includes('blood level') || d.includes('auc'))
    return { mechanism: 'Altered distribution / elimination', effect: 'Changed blood drug concentration', recommendation: 'Monitor drug levels and adjust dose accordingly.', category: 'pk', interactionType: 'PK' };
  if (d.includes('absorption') || d.includes('bioavailability') || d.includes('cmax'))
    return { mechanism: 'GI absorption affected', effect: 'Reduced drug bioavailability', recommendation: 'Take at least 2–4 hours apart.', category: 'absorption', interactionType: 'PK' };
  if (d.includes('protein binding') || d.includes('plasma protein'))
    return { mechanism: 'Plasma protein binding competition', effect: 'Increased free drug fraction', recommendation: 'Monitor effects and toxicity of both drugs.', category: 'protein', interactionType: 'PK' };

  return { mechanism: 'Pharmacokinetic / pharmacodynamic interaction', effect: 'Altered efficacy or toxicity', recommendation: 'Monitor clinically when combining the two drugs.', category: 'pk', interactionType: 'PK' };
}

const CAT_STYLE: Record<string, { bg: string; border: string; text: string; icon: string; label: string }> = {
  serotonin:  { bg: 'bg-pink-50',    border: 'border-pink-300',   text: 'text-pink-700',    icon: '🧠', label: 'Serotonin' },
  cardiac:    { bg: 'bg-red-50',     border: 'border-red-300',    text: 'text-red-700',     icon: '❤️', label: 'Cardiovascular' },
  bleeding:   { bg: 'bg-red-50',     border: 'border-red-300',    text: 'text-red-700',     icon: '🩸', label: 'Bleeding' },
  renal:      { bg: 'bg-teal-50',    border: 'border-teal-300',   text: 'text-teal-700',    icon: '🫘', label: 'Renal' },
  hepatic:    { bg: 'bg-yellow-50',  border: 'border-yellow-300', text: 'text-yellow-700',  icon: '🫀', label: 'Hepatic' },
  metabolic:  { bg: 'bg-orange-50',  border: 'border-orange-300', text: 'text-orange-700',  icon: '⚗️',  label: 'CYP450' },
  pk:         { bg: 'bg-blue-50',    border: 'border-blue-300',   text: 'text-blue-700',    icon: '🔬', label: 'PK' },
  absorption: { bg: 'bg-purple-50',  border: 'border-purple-300', text: 'text-purple-700',  icon: '💊', label: 'Absorption' },
  protein:    { bg: 'bg-indigo-50',  border: 'border-indigo-300', text: 'text-indigo-700',  icon: '🧬', label: 'Protein' },
  cns:        { bg: 'bg-slate-50',   border: 'border-slate-300',  text: 'text-slate-700',   icon: '🧬', label: 'CNS' },
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function fmtDateShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' });
}

// ── Sub-components ─────────────────────────────────────────────────────────

function PathwayDiagram({ ix }: { ix: InteractionRec }) {
  const pw = parsePathway(ix);
  const sev = SEV[normSev(ix.severity)];
  const cat = CAT_STYLE[pw.category] ?? CAT_STYLE.pk;
  const sevBorderColor = ix.severity === 'major' ? '#fca5a5' : ix.severity === 'moderate' ? '#fcd34d' : '#86efac';

  return (
    <div className="rounded-xl bg-slate-50 border border-gray-200 p-5 overflow-x-auto">
      <div className="flex items-center gap-1 min-w-max mx-auto justify-center">

        {/* Drug nodes (stacked) */}
        <div className="flex flex-col gap-2.5">
          <div className="bg-blue-50 border-2 border-blue-200 rounded-xl px-4 py-2.5 w-32 text-center shadow-sm">
            <div className="text-[9px] font-bold text-blue-400 uppercase tracking-wider mb-0.5">💊 Drug A</div>
            <div className="text-xs font-bold text-blue-700 truncate" title={ix.drug_a_name}>{ix.drug_a_name}</div>
          </div>
          <div className="bg-violet-50 border-2 border-violet-200 rounded-xl px-4 py-2.5 w-32 text-center shadow-sm">
            <div className="text-[9px] font-bold text-violet-400 uppercase tracking-wider mb-0.5">💊 Drug B</div>
            <div className="text-xs font-bold text-violet-700 truncate" title={ix.drug_b_name}>{ix.drug_b_name}</div>
          </div>
        </div>

        {/* Bracket SVG connecting both drugs to mechanism */}
        <svg width="36" height="80" viewBox="0 0 36 80" fill="none" className="shrink-0">
          <path d="M2 20 H18 V40 M18 40 V60 H2 M18 40 H36" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        {/* Mechanism node */}
        <div className={`rounded-xl px-4 py-3.5 w-40 text-center border-2 shadow-sm ${cat.bg} ${cat.border}`}>
          <div className="text-2xl mb-1.5">{cat.icon}</div>
          <div className={`text-[9px] font-bold uppercase tracking-widest mb-1 opacity-70 ${cat.text}`}>{pw.interactionType} · {cat.label}</div>
          <div className={`text-xs font-bold leading-tight ${cat.text}`}>{pw.mechanism}</div>
        </div>

        {/* Arrow */}
        <svg width="32" height="12" viewBox="0 0 32 12" fill="none" className="shrink-0">
          <path d="M0 6 H24" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M20 2 L28 6 L20 10" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        {/* Effect node */}
        <div className={`rounded-xl px-4 py-3.5 w-40 text-center border-2 shadow-sm ${sev.bg}`} style={{ borderColor: sevBorderColor }}>
          <div className="text-2xl mb-1.5">⚠️</div>
          <div className={`text-[9px] font-bold uppercase tracking-widest mb-1 opacity-70 ${sev.text}`}>Clinical Outcome</div>
          <div className={`text-xs font-bold leading-tight ${sev.text}`}>{pw.effect}</div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-4 pt-3 border-t border-gray-200">
        <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
          <span className="w-3 h-3 rounded-full bg-blue-200 border border-blue-300" /> Drug A
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
          <span className="w-3 h-3 rounded-full bg-violet-200 border border-violet-300" /> Drug B
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
          <span className={`w-3 h-3 rounded-full ${cat.bg} border ${cat.border}`} /> Mechanism ({pw.interactionType})
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
          <span className={`w-3 h-3 rounded-full ${sev.bg}`} style={{ border: `1px solid ${sevBorderColor}` }} /> Outcome
        </span>
      </div>
    </div>
  );
}

function InteractionDetailModal({ ix, onClose }: { ix: InteractionRec; onClose: () => void }) {
  const pw = parsePathway(ix);
  const sev = SEV[normSev(ix.severity)];
  const sevBorderColor = ix.severity === 'major' ? '#fca5a5' : ix.severity === 'moderate' ? '#fcd34d' : '#86efac';

  const severityMeta = {
    major:    { label: 'High Risk',  desc: 'Interaction may be life-threatening or cause irreversible damage. Immediate medical intervention required.', icon: '🚨' },
    moderate: { label: 'Moderate',    desc: 'Interaction may cause significant clinical events. Dose adjustment or close monitoring required.',      icon: '⚠️' },
    minor:    { label: 'Low',           desc: 'Interaction has limited clinical significance. Usually no intervention required but should be monitored.',   icon: 'ℹ️' },
    unknown:  { label: 'Low',           desc: 'Interaction has limited clinical significance. Usually no intervention required but should be monitored.',   icon: 'ℹ️' },
  };
  const sm = severityMeta[normSev(ix.severity)];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className={`px-6 py-5 border-b-2 ${sev.bg}`} style={{ borderColor: sevBorderColor }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="font-extrabold text-gray-800 text-base">{ix.drug_a_name}</span>
                <svg width="20" height="10" viewBox="0 0 20 10" fill="none" className="shrink-0">
                  <path d="M0 5 H14 M10 1 L18 5 L10 9" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="font-extrabold text-gray-800 text-base">{ix.drug_b_name}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <RiskBadge sev={ix.severity} />
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sev.bg} ${sev.text}`}>{sm.icon} {sm.label}</span>
                <span className="text-[10px] text-gray-400 italic">Source: DrugBank® v5</span>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-black/10 transition-colors shrink-0">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Severity explanation ── */}
        <div className={`px-6 py-3 border-b border-gray-100 ${sev.bg}`}>
          <p className={`text-xs ${sev.text}`}>{sm.desc}</p>
        </div>

        {/* ── Pathway Diagram ── */}
        <div className="px-6 py-5 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
            <Activity size={14} className="text-violet-500" /> Interaction Pathway Diagram
          </h3>
          <PathwayDiagram ix={ix} />
        </div>

        {/* ── Mechanism analysis cards ── */}
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
            <FlaskConical size={14} className="text-orange-500" /> Mechanism Analysis
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Interaction Type</div>
              <div className="text-2xl font-extrabold text-primary-700">{pw.interactionType}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">
                {pw.interactionType === 'PK' ? 'Pharmacokinetic' : 'Pharmacodynamic'}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-3">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Main Mechanism</div>
              <div className="text-xs font-bold text-gray-700 leading-tight">{pw.mechanism}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-3">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Expected Outcome</div>
              <div className={`text-xs font-bold leading-tight ${sev.text}`}>{pw.effect}</div>
            </div>
          </div>
          <div className="mt-3 bg-white rounded-xl border border-gray-200 p-3">
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              {pw.interactionType === 'PK' ? '⚙️ Pharmacokinetic Interaction (PK)' : '⚡ Pharmacodynamic Interaction (PD)'}
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              {pw.interactionType === 'PK'
                ? 'Interaction occurs at the level of absorption, distribution, metabolism, or elimination — affecting blood drug concentration without directly acting on receptors.'
                : 'Interaction occurs at the pharmacological level — both drugs act on the same receptor, enzyme, or signaling pathway, increasing/decreasing efficacy or increasing toxicity.'}
            </p>
          </div>
        </div>

        {/* ── Full DrugBank description ── */}
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
            <FileText size={14} className="text-blue-500" /> Detailed description (DrugBank)
          </h3>
          <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">
            {ix.description || 'No detailed description available in DrugBank for this drug pair.'}
          </p>
        </div>

        {/* ── Clinical recommendation ── */}
        <div className="px-6 py-5">
          <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
            <Shield size={14} className="text-green-500" /> Clinical Recommendation
          </h3>
          <div className={`rounded-xl border-2 p-4 ${sev.bg}`} style={{ borderColor: sevBorderColor }}>
            <p className={`text-sm font-semibold ${sev.text}`}>⚕️ {pw.recommendation}</p>
          </div>
          <p className="text-[10px] text-gray-400 mt-3 italic text-center">
            ⚠️ For academic reference only — does not replace professional clinical advice.
          </p>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string | number;
  sub?: string; color: string;
}) {
  return (
    <div className={`rounded-2xl border p-5 flex items-start gap-4 ${color}`}>
      <div className="p-2.5 rounded-xl bg-white/60 shadow-sm">{icon}</div>
      <div>
        <p className="text-xs font-medium opacity-70 uppercase tracking-wide">{label}</p>
        <p className="text-3xl font-bold mt-0.5">{value}</p>
        {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function RiskBadge({ sev }: { sev: string }) {
  const s = SEV[normSev(sev)];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function SessionCard({ session, onDelete, onEdit, onOpen }: {
  session: Session;
  onDelete: (id: number) => void;
  onEdit: (session: Session) => void;
  onOpen: (session: Session) => void;
}) {
  const tags = session.tags ? session.tags.split('|').filter(Boolean) : [];
  const riskColor = session.major_count > 0 ? 'border-l-red-500'
    : session.moderate_count > 0 ? 'border-l-amber-400'
    : 'border-l-green-500';

  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm border-l-4 ${riskColor} transition-all hover:shadow-md`}>
      {/* Clickable title area */}
      <div className="p-5 cursor-pointer" onClick={() => onOpen(session)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-800 text-sm hover:text-violet-700 transition-colors">{session.title}</h3>
              {session.major_count > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                  <AlertTriangle size={9} /> {session.major_count} high risk
                </span>
              )}
              {session.total_interactions > 0 && (
                <span className="text-[10px] text-violet-500 font-medium">View analysis →</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
              <span className="flex items-center gap-1"><Clock size={10} />{fmtDateShort(session.created_at)}</span>
              <span className="flex items-center gap-1"><Pill size={10} />{session.total_drugs} drugs</span>
              <span className="flex items-center gap-1"><Zap size={10} />{session.total_interactions} interactions</span>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tags.map(t => (
                  <span key={t} className="text-[10px] bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full">{t}</span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
            <button onClick={() => onEdit(session)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
              <Edit3 size={14} />
            </button>
            <button onClick={() => onDelete(session.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Drug pills */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {(session.drugs_snapshot ?? []).map(d => (
            <span key={d.id}
              className="text-[11px] bg-primary-50 text-primary-700 border border-primary-100 px-2.5 py-0.5 rounded-full font-medium">
              {d.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Session Detail Modal (click title → show all interactions with pathway) ──

function SessionDetailModal({ session, onClose }: { session: Session; onClose: () => void }) {
  const drugs = session.drugs_snapshot ?? [];

  // Detect data gap: interactions_found not stored (old sessions) but counts say there are interactions
  const dataGap = (!session.interactions_found || session.interactions_found.length === 0)
    && (session.total_interactions > 0 || session.major_count > 0);

  // When dataGap, fetch live interaction data from the database
  const [liveIxs, setLiveIxs] = useState<InteractionRec[] | null>(null);
  const [fetchLoading, setFetchLoading] = useState(false);

  useEffect(() => {
    const sessionDrugs = session.drugs_snapshot ?? [];
    const isDataGap = (!session.interactions_found || session.interactions_found.length === 0)
      && (session.total_interactions > 0 || session.major_count > 0);

    if (!isDataGap || sessionDrugs.length === 0) return;

    const drugIds = new Set(sessionDrugs.map(d => d.id));
    const drugById = Object.fromEntries(sessionDrugs.map(d => [d.id, d.name]));

    setFetchLoading(true);
    Promise.all(
      sessionDrugs.map(drug =>
        apiFetchDrugInteractions(drug.id, 1, 500)
          .then(data =>
            data.items
              // Keep only interactions where the other drug is also in this session
              .filter(ix =>
                ix.interacting_drug_id !== drug.id && drugIds.has(ix.interacting_drug_id)
              )
              .map(ix => ({
                drug_a_id: ix.drug_id ?? drug.id,
                drug_a_name: drugById[ix.drug_id ?? ''] ?? drug.name,
                drug_b_id: ix.interacting_drug_id,
                drug_b_name: ix.interacting_drug_name ?? ix.interacting_drug_id,
                severity: ix.severity ?? 'unknown',
                description: ix.description ?? '',
                source: 'DrugBank',
              } as InteractionRec)
            )
          )
          .catch(() => [] as InteractionRec[])
      )
    ).then(results => {
      const all = results.flat();
      // Deduplicate: same pair A-B may appear from both drug A's and drug B's query
      const seen = new Set<string>();
      const deduped = all.filter(ix => {
        const key = [ix.drug_a_id, ix.drug_b_id].sort().join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setLiveIxs(deduped);
      setFetchLoading(false);

      // Auto-select first pair that has an interaction
      let firstIxIdx = 0;
      let pairCount = 0;
      let found = false;
      for (let i = 0; i < sessionDrugs.length && !found; i++) {
        for (let j = i + 1; j < sessionDrugs.length && !found; j++) {
          const hasIx = deduped.some(
            ix => (ix.drug_a_id === sessionDrugs[i].id && ix.drug_b_id === sessionDrugs[j].id) ||
                  (ix.drug_a_id === sessionDrugs[j].id && ix.drug_b_id === sessionDrugs[i].id)
          );
          if (hasIx) { firstIxIdx = pairCount; found = true; }
          pairCount++;
        }
      }
      setActivePairIdx(firstIxIdx);
    });
  }, [session.id]);

  // Build all pairs — use liveIxs when dataGap and available, else interactions_found
  const ixSource: InteractionRec[] = (dataGap && liveIxs !== null) ? liveIxs : (session.interactions_found ?? []);
  const allPairs: { a: DrugSnap; b: DrugSnap; ix: InteractionRec | null }[] = [];
  for (let i = 0; i < drugs.length; i++) {
    for (let j = i + 1; j < drugs.length; j++) {
      const found = ixSource.find(
        ix => (ix.drug_a_id === drugs[i].id && ix.drug_b_id === drugs[j].id) ||
              (ix.drug_a_id === drugs[j].id && ix.drug_b_id === drugs[i].id)
      ) ?? null;
      allPairs.push({ a: drugs[i], b: drugs[j], ix: found });
    }
  }

  const [activePairIdx, setActivePairIdx] = useState<number>(0);
  const activePair = allPairs[activePairIdx] ?? null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-3 sticky top-0 bg-white z-10 rounded-t-2xl">
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h2 className="font-extrabold text-gray-800 text-base">{session.title}</h2>
              {session.major_count > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                  <AlertTriangle size={9}/> {session.major_count} high risk
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span className="flex items-center gap-1"><Clock size={10}/>{fmtDate(session.created_at)}</span>
              <span className="flex items-center gap-1"><Pill size={10}/>{session.total_drugs} drugs</span>
              <span className="flex items-center gap-1"><Zap size={10}/>{session.total_interactions} interactions</span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 transition-colors shrink-0"><X size={16}/></button>
        </div>

        {/* Drugs row */}
        <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap gap-2">
          {drugs.map(d => (
            <span key={d.id} className="text-[11px] bg-blue-50 text-blue-700 border border-blue-100 px-2.5 py-0.5 rounded-full font-semibold">
              💊 {d.name}
            </span>
          ))}
        </div>

        {/* Notes */}
        {session.notes && (
          <div className="px-6 py-3 bg-amber-50 border-b border-amber-100 text-xs text-amber-700 flex gap-2">
            <Info size={12} className="shrink-0 mt-0.5"/> {session.notes}
          </div>
        )}

        {/* Loading indicator while fetching live data */}
        {dataGap && fetchLoading && (
          <div className="px-6 py-3 bg-blue-50 border-b border-blue-100 text-xs text-blue-700 flex items-center gap-2">
            <RefreshCw size={12} className="animate-spin shrink-0"/> Loading interaction data from database...
          </div>
        )}

        {/* Warn if data gap resolved but still no interactions found in DB */}
        {dataGap && !fetchLoading && liveIxs !== null && liveIxs.length === 0 && (
          <div className="px-6 py-3 bg-orange-50 border-b border-orange-100 text-xs text-orange-700 flex gap-2">
            <AlertTriangle size={12} className="shrink-0 mt-0.5"/>
            Interaction details not found in current database. Data may not be fully synchronized.
          </div>
        )}

        {/* Main content: loading skeleton or pair selector + detail */}
        {dataGap && fetchLoading ? (
          <div className="px-6 py-16 text-center flex flex-col items-center gap-3 text-gray-400">
            <RefreshCw size={28} className="animate-spin text-blue-400"/>
            <p className="text-sm font-medium">Analyzing interactions...</p>
            <p className="text-xs opacity-60">Querying DrugBank database</p>
          </div>
        ) : (
          <>
            {/* Pair selector (if >1 pair) */}
            {allPairs.length > 1 && (
              <div className="px-6 pt-4 pb-2 border-b border-gray-100">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                  {allPairs.length} pairs — select to view analysis:
                </p>
                <div className="flex flex-wrap gap-2">
                  {allPairs.map((p, i) => {
                    const isActive = i === activePairIdx;
                    const hasIx = p.ix !== null;
                    const s = hasIx ? SEV[normSev(p.ix!.severity)] : null;
                    return (
                      <button key={i} onClick={() => setActivePairIdx(i)}
                        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-semibold border transition-all ${
                          isActive
                            ? s ? `${s.bg} ${s.text} border-current ring-2 ring-offset-1` : 'bg-green-50 text-green-700 border-green-300 ring-2 ring-offset-1'
                            : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300'
                        }`}>
                        <span className={`w-2 h-2 rounded-full ${s ? s.dot : 'bg-green-400'}`}/>
                        {p.a.name} × {p.b.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Active pair detail */}
            {activePair ? (
              activePair.ix ? (
                <IxDetailInline ix={activePair.ix} />
              ) : (
                <SafePairDetail drugA={activePair.a} drugB={activePair.b} />
              )
            ) : (
              <div className="px-6 py-12 text-center text-gray-400 text-sm">
                No drugs in the regimen.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SafePairDetail({ drugA, drugB }: { drugA: DrugSnap; drugB: DrugSnap }) {
  return (
    <div className="px-6 py-4 space-y-4">
      {/* Safe banner */}
      <div className="rounded-xl border-2 border-green-200 bg-green-50 px-4 py-3 flex items-start gap-3">
        <span className="text-2xl">✅</span>
        <div>
          <div className="font-bold text-sm text-green-700">{drugA.name} × {drugB.name}</div>
          <div className="text-xs mt-0.5 text-green-600 opacity-80">
            No known interactions found in DrugBank® v5
          </div>
        </div>
      </div>

      {/* Safe pathway diagram */}
      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
          <Activity size={14} className="text-violet-500"/> Interaction Check Diagram
        </h3>
        <div className="rounded-xl bg-slate-50 border border-gray-200 p-5 overflow-x-auto">
          <div className="flex items-center gap-2 min-w-max mx-auto justify-center">
            <div className="flex flex-col gap-2.5">
              <div className="bg-blue-50 border-2 border-blue-200 rounded-xl px-4 py-2.5 w-32 text-center shadow-sm">
                <div className="text-[9px] font-bold text-blue-400 uppercase tracking-wider mb-0.5">💊 Drug A</div>
                <div className="text-xs font-bold text-blue-700 truncate" title={drugA.name}>{drugA.name}</div>
              </div>
              <div className="bg-violet-50 border-2 border-violet-200 rounded-xl px-4 py-2.5 w-32 text-center shadow-sm">
                <div className="text-[9px] font-bold text-violet-400 uppercase tracking-wider mb-0.5">💊 Drug B</div>
                <div className="text-xs font-bold text-violet-700 truncate" title={drugB.name}>{drugB.name}</div>
              </div>
            </div>
            <svg width="36" height="80" viewBox="0 0 36 80" fill="none" className="shrink-0">
              <path d="M2 20 H18 V40 M18 40 V60 H2 M18 40 H36" stroke="#86efac" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div className="bg-green-50 border-2 border-green-300 rounded-xl px-4 py-3.5 w-40 text-center shadow-sm">
              <div className="text-2xl mb-1.5">🔬</div>
              <div className="text-[9px] font-bold text-green-500 uppercase tracking-widest mb-1">DrugBank Check</div>
              <div className="text-xs font-bold text-green-700">24,386+ classified pairs</div>
            </div>
            <svg width="32" height="12" viewBox="0 0 32 12" fill="none" className="shrink-0">
              <path d="M0 6 H24" stroke="#86efac" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M20 2 L28 6 L20 10" stroke="#86efac" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div className="bg-green-50 border-2 border-green-300 rounded-xl px-4 py-3.5 w-40 text-center shadow-sm">
              <div className="text-2xl mb-1.5">✅</div>
              <div className="text-[9px] font-bold text-green-500 uppercase tracking-widest mb-1">Result</div>
              <div className="text-xs font-bold text-green-700">No known interaction</div>
            </div>
          </div>
          <div className="flex items-center justify-center gap-6 mt-4 pt-3 border-t border-gray-200 text-[10px] text-gray-400">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-200 border border-blue-300"/>{drugA.name}</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-violet-200 border border-violet-300"/>{drugB.name}</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-200 border border-green-300"/>Safe</span>
          </div>
        </div>
      </div>

      {/* Explanation */}
      <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 space-y-3">
        <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
          <FileText size={14} className="text-blue-500"/> Clinical Significance
        </h3>
        <div className="grid grid-cols-1 gap-2 text-xs text-gray-600">
          <div className="flex gap-2 bg-white rounded-lg p-3 border border-gray-100">
            <span className="text-green-500 font-bold shrink-0">✓</span>
            <span><strong>No known interaction</strong> in the DrugBank v5 database — over 24,000 classified clinical interaction pairs.</span>
          </div>
          <div className="flex gap-2 bg-white rounded-lg p-3 border border-gray-100">
            <span className="text-amber-500 font-bold shrink-0">⚠</span>
            <span><strong>No known interaction ≠ completely safe</strong>. The database only records interactions that have been studied and published.</span>
          </div>
          <div className="flex gap-2 bg-white rounded-lg p-3 border border-gray-100">
            <span className="text-blue-500 font-bold shrink-0">ℹ</span>
            <span>Consult a clinical pharmacist or treating physician before combining drugs in practice.</span>
          </div>
        </div>
      </div>

      <p className="text-[10px] text-gray-400 italic text-center pb-2">
        ⚠️ For academic reference only — does not replace professional clinical advice.
      </p>
    </div>
  );
}



function IxDetailInline({ ix }: { ix: InteractionRec }) {
  const pw = parsePathway(ix);
  const sev = SEV[normSev(ix.severity)];
  const sevBorderColor = ix.severity === 'major' ? '#fca5a5' : ix.severity === 'moderate' ? '#fcd34d' : '#86efac';

  const severityMeta = {
    major:    { label: 'High Risk', desc: 'Interaction may be life-threatening. Immediate medical intervention required.', icon: '🚨' },
    moderate: { label: 'Moderate',  desc: 'May cause significant clinical events. Dose adjustment or close monitoring required.', icon: '⚠️' },
    minor:    { label: 'Low',       desc: 'Limited clinical significance. Usually no intervention required but should be monitored.', icon: 'ℹ️' },
    unknown:  { label: 'Low',       desc: 'Limited clinical significance. Usually no intervention required but should be monitored.', icon: 'ℹ️' },
  };
  const sm = severityMeta[normSev(ix.severity)];

  return (
    <div className="px-6 py-4 space-y-4">
      {/* Severity banner */}
      <div className={`rounded-xl border-2 px-4 py-3 flex items-start gap-3 ${sev.bg}`} style={{ borderColor: sevBorderColor }}>
        <span className="text-2xl">{sm.icon}</span>
        <div>
          <div className={`font-bold text-sm ${sev.text}`}>{ix.drug_a_name} × {ix.drug_b_name}</div>
          <div className={`text-xs mt-0.5 ${sev.text} opacity-80`}>{sm.label} — {sm.desc}</div>
        </div>
        <RiskBadge sev={ix.severity} />
      </div>

      {/* Pathway diagram */}
      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
          <Activity size={14} className="text-violet-500"/> Interaction Pathway Diagram
        </h3>
        <PathwayDiagram ix={ix} />
      </div>

      {/* Mechanism cards */}
      <div className="bg-gray-50 rounded-xl p-4">
        <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
          <FlaskConical size={14} className="text-orange-500"/> Mechanism Analysis
        </h3>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Interaction Type</div>
            <div className="text-2xl font-extrabold text-violet-700">{pw.interactionType}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{pw.interactionType === 'PK' ? 'Pharmacokinetic' : 'Pharmacodynamic'}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3">
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Main Mechanism</div>
            <div className="text-xs font-bold text-gray-700 leading-tight">{pw.mechanism}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3">
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Expected Outcome</div>
            <div className={`text-xs font-bold leading-tight ${sev.text}`}>{pw.effect}</div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3">
          <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">
            {pw.interactionType === 'PK' ? '⚙️ Pharmacokinetics (PK)' : '⚡ Pharmacodynamic (PD)'}
          </div>
          <p className="text-xs text-gray-600 leading-relaxed">
            {pw.interactionType === 'PK'
              ? 'Interaction at the level of absorption, distribution, metabolism, or elimination — affecting blood drug concentration without directly acting on receptors.'
              : 'Interaction at the pharmacological level — both drugs act on the same receptor, enzyme, or signaling pathway, altering efficacy or toxicity.'}
          </p>
        </div>
      </div>

      {/* Full description */}
      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
          <FileText size={14} className="text-blue-500"/> Detailed description (DrugBank)
        </h3>
        <p className="text-sm text-gray-600 leading-relaxed bg-gray-50 rounded-xl p-4 border border-gray-100">
          {ix.description || 'No detailed description available in DrugBank for this drug pair.'}
        </p>
      </div>

      {/* Clinical recommendation */}
      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
          <Shield size={14} className="text-green-500"/> Clinical Recommendation
        </h3>
        <div className={`rounded-xl border-2 p-4 ${sev.bg}`} style={{ borderColor: sevBorderColor }}>
          <p className={`text-sm font-semibold ${sev.text}`}>⚕️ {pw.recommendation}</p>
        </div>
      </div>

      <p className="text-[10px] text-gray-400 italic text-center pb-2">
        ⚠️ For academic reference only — does not replace professional clinical advice.
      </p>
    </div>
  );
}



function EditModal({ session, onClose, onSave }: {
  session: Session; onClose: () => void; onSave: (id: number, title: string, tags: string, notes: string) => void;
}) {
  const [title, setTitle] = useState(session.title);
  const [tags, setTags] = useState(session.tags ?? '');
  const [notes, setNotes] = useState(session.notes ?? '');
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800">Edit Session</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Session Name</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Labels (separated by |)</label>
            <input value={tags} onChange={e => setTags(e.target.value)}
              placeholder="Cardiology|ICU|Diabetes" 
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Clinical Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="Notes about patient, clinical context..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-400 resize-none" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">Cancel</button>
          <button onClick={() => { onSave(session.id, title, tags, notes); onClose(); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary-800 text-white text-sm font-semibold rounded-xl hover:bg-primary-700 transition-colors">
            <Save size={14} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Mini bar chart ──────────────────────────────────────────────────────────

function MiniBarChart({ data, max, color }: { data: { name: string; count: number }[]; max: number; color: string }) {
  return (
    <div className="space-y-2">
      {data.map(({ name, count }) => (
        <div key={name} className="flex items-center gap-2">
          <span className="text-xs text-gray-600 w-28 truncate shrink-0">{name}</span>
          <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
            <div className={`h-2 rounded-full ${color} transition-all duration-500`}
              style={{ width: `${max ? (count / max) * 100 : 0}%` }} />
          </div>
          <span className="text-xs text-gray-500 w-6 text-right shrink-0">{count}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function AnalysisPage() {
  const { user, token } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  void expandedId; void setExpandedId;
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [selectedInteraction, setSelectedInteraction] = useState<InteractionRec | null>(null);
  const [openSession, setOpenSession] = useState<Session | null>(null);
  const [activeTab, setActiveTab] = useState<'history' | 'stats' | 'compare'>('history');
  const [backendOk, setBackendOk] = useState(true);
  const navigate = useNavigate();

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!token) {
      // Guest — load from sessionStorage only
      try {
        const raw = sessionStorage.getItem('medidb_guest_session');
        if (raw) {
          const detail = JSON.parse(raw) as { drugs_snapshot: DrugSnap[]; interactions_found: InteractionRec[] };
          const guestSession: Session = {
            id: -1,
            title: `Regimen: ${(detail.drugs_snapshot ?? []).map(d => d.name).join(', ')}`,
            tags: null,
            total_drugs: detail.drugs_snapshot?.length ?? 0,
            total_interactions: detail.interactions_found?.length ?? 0,
            major_count: detail.interactions_found?.filter(ix => ix.severity === 'major').length ?? 0,
            moderate_count: detail.interactions_found?.filter(ix => ix.severity === 'moderate').length ?? 0,
            minor_count: detail.interactions_found?.filter(ix => ix.severity === 'minor').length ?? 0,
            risk_score: null,
            risk_level: null,
            drugs_snapshot: detail.drugs_snapshot ?? [],
            interactions_found: detail.interactions_found ?? [],
            notes: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          setSessions([guestSession]);
        } else {
          setSessions([]);
        }
      } catch { setSessions([]); }
      setStats(null);
      setLoading(false);
      return;
    }

    // Logged in — fetch from API with auth token
    try {
      const authHeader = { 'Authorization': `Bearer ${token}` };
      const [sRes, stRes] = await Promise.all([
        fetch(`/api/v1/sessions?limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}${filterTag ? `&tag=${encodeURIComponent(filterTag)}` : ''}`, { headers: authHeader }),
        fetch('/api/v1/sessions/stats', { headers: authHeader }),
      ]);
      if (!sRes.ok || !stRes.ok) throw new Error('Backend not responding');
      setSessions(await sRes.json());
      setStats(await stRes.json());
      setBackendOk(true);
    } catch {
      setBackendOk(false);
      setError('Could not connect to backend server.');
    } finally {
      setLoading(false);
    }
  }, [search, filterTag, token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const deleteSession = async (id: number) => {
    if (id === -1) {
      // Guest session — just clear sessionStorage
      sessionStorage.removeItem('medidb_guest_session');
      setSessions([]);
      return;
    }
    if (!token || !confirm('Delete this session?')) return;
    await fetch(`/api/v1/sessions/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    setSessions(prev => prev.filter(s => s.id !== id));
    if (stats) setStats({ ...stats, total_sessions: stats.total_sessions - 1 });
  };

  const updateSession = async (id: number, title: string, tags: string, notes: string) => {
    if (id === -1 || !token) return;
    const res = await fetch(`/api/v1/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ title, tags, notes }),
    });
    if (res.ok) {
      const updated = await res.json();
      setSessions(prev => prev.map(s => s.id === id ? updated : s));
    }
  };

  const toggleExpand = (id: number) => setExpandedId(prev => prev === id ? null : id);
  void toggleExpand; // kept to avoid lint error

  // Collect all unique tags from sessions
  const allTags = Array.from(new Set(
    sessions.flatMap(s => s.tags ? s.tags.split('|').filter(Boolean) : [])
  ));

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero header */}
      <div className="bg-gradient-to-br from-violet-900 via-purple-800 to-indigo-900 text-white">
        <div className="max-w-7xl mx-auto px-4 py-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <nav className="flex items-center gap-2 text-sm text-violet-300 mb-4">
                <Link to="/" className="hover:text-white transition-colors">Home</Link>
                <ChevronRight size={14} />
                <span className="text-white font-medium">Analysis Tools</span>
              </nav>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2.5 bg-white/10 rounded-xl backdrop-blur-sm">
                  <BarChart2 size={26} className="text-violet-200" />
                </div>
                <h1 className="text-3xl font-bold">Analysis & Interaction History</h1>
              </div>
              <p className="text-violet-200 text-sm max-w-xl">
                Permanently store drug interaction check sessions, categorize by disease groups, and track clinical trends.
              </p>
            </div>
            <button onClick={() => navigate('/interactions')}
              className="shrink-0 flex items-center gap-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/20 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all">
              <Zap size={15} className="text-amber-300" />
              New Interaction Check
            </button>
          </div>

          {/* Quick stats row */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-8">
              {[
                { label: 'Saved Sessions', value: stats.total_sessions, icon: <Database size={16} />, color: 'text-violet-300' },
                { label: 'Interactions Checked', value: stats.total_interactions_checked, icon: <Zap size={16} />, color: 'text-amber-300' },
                { label: 'High Risk Pairs', value: stats.total_major, icon: <AlertTriangle size={16} />, color: 'text-red-300' },
                { label: 'Moderate Pairs', value: stats.total_moderate, icon: <Shield size={16} />, color: 'text-orange-300' },
              ].map(item => (
                <div key={item.label} className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                  <div className={`flex items-center gap-1.5 text-xs font-medium mb-1 ${item.color}`}>
                    {item.icon} {item.label}
                  </div>
                  <div className="text-2xl font-bold">{item.value.toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Guest banner */}
      {!user && (
        <div className="bg-amber-50 border-b border-amber-200">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-amber-800">
              <LogIn size={15} className="shrink-0 text-amber-600"/>
              <span>You are viewing as a guest. Check results are <strong>saved in this session only</strong> — closing the tab or reloading will lose them.</span>
            </div>
            <Link to="/auth"
              className="shrink-0 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white px-4 py-1.5 rounded-lg transition-colors">
              Sign In / Sign Up
            </Link>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 sticky top-[104px] z-30">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-0.5">
            {([
              { id: 'history', label: 'Session History', icon: <Clock size={14} /> },
              { id: 'stats', label: 'Statistics', icon: <TrendingUp size={14} /> },
              { id: 'compare', label: 'Drug Comparison', icon: <Activity size={14} /> },
            ] as const).map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-violet-600 text-violet-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-200'
                }`}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Backend offline warning */}
        {!backendOk && (
          <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-700 text-sm">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <strong>Backend not connected.</strong> History data requires a connection to the backend server.
              The interaction checker still works normally.
            </div>
          </div>
        )}

        {/* ═══════════════════ TAB: HISTORY ═══════════════════ */}
        {activeTab === 'history' && (
          <div>
            {/* Search + filter bar */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <div className="flex-1 flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 shadow-sm focus-within:border-violet-400 transition-colors">
                <Search size={15} className="text-gray-400 shrink-0" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search sessions by drug name..."
                  className="flex-1 text-sm outline-none text-gray-700 placeholder-gray-400" />
                {search && <button onClick={() => setSearch('')}><X size={14} className="text-gray-400" /></button>}
              </div>
              {allTags.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Tag size={13} className="text-gray-400" />
                  {allTags.slice(0, 6).map(t => (
                    <button key={t} onClick={() => setFilterTag(filterTag === t ? '' : t)}
                      className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                        filterTag === t ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300'
                      }`}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={fetchAll} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-xl hover:bg-gray-100 transition-colors shrink-0">
                <RefreshCw size={13} /> Reload
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20 text-gray-400 gap-3">
                <RefreshCw size={18} className="animate-spin" /> Loading history...
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-16 h-16 bg-violet-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <BarChart2 size={28} className="text-violet-300" />
                </div>
                <h3 className="font-semibold text-gray-700 mb-1">No sessions yet</h3>
                <p className="text-gray-400 text-sm mb-5">Check drug interactions and click "Save Session" to save here.</p>
                <Link to="/interactions"
                  className="inline-flex items-center gap-2 bg-violet-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-violet-700 transition-colors">
                  <Zap size={14} /> Start Interaction Check
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {sessions.map(s => (
                  <SessionCard key={s.id} session={s}
                    onDelete={deleteSession}
                    onEdit={setEditingSession}
                    onOpen={setOpenSession}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════ TAB: STATS ═══════════════════ */}
        {activeTab === 'stats' && stats && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Severity breakdown */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h3 className="font-bold text-gray-800 mb-5 flex items-center gap-2">
                <Shield size={16} className="text-violet-600" /> Interaction Severity Distribution
              </h3>
              {(() => {
                const total = stats.total_major + stats.total_moderate + stats.total_minor;
                return total === 0 ? (
                  <p className="text-sm text-gray-400">No data available</p>
                ) : (
                  <div className="space-y-4">
                    {[
                      { label: 'High Risk', count: stats.total_major, color: 'bg-red-500', textColor: 'text-red-600', pct: Math.round((stats.total_major/total)*100) },
                      { label: 'Moderate', count: stats.total_moderate, color: 'bg-amber-400', textColor: 'text-amber-600', pct: Math.round((stats.total_moderate/total)*100) },
                      { label: 'Low / Unknown', count: stats.total_minor, color: 'bg-green-500', textColor: 'text-green-600', pct: Math.round((stats.total_minor/total)*100) },
                    ].map(row => (
                      <div key={row.label}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={`text-sm font-medium ${row.textColor}`}>{row.label}</span>
                          <span className="text-sm text-gray-500">{row.count} ({row.pct}%)</span>
                        </div>
                        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-3 rounded-full ${row.color} transition-all duration-700`} style={{ width: `${row.pct}%` }} />
                        </div>
                      </div>
                    ))}
                    <div className="mt-4 pt-4 border-t border-gray-50 text-sm text-gray-400">
                      Total {total.toLocaleString()} interaction pairs from {stats.total_sessions} sessions
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Top drugs */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h3 className="font-bold text-gray-800 mb-5 flex items-center gap-2">
                <Star size={16} className="text-amber-500" /> Most Frequently Checked Drugs
              </h3>
              {stats.most_checked_drugs.length === 0 ? (
                <p className="text-sm text-gray-400">No data available</p>
              ) : (
                <MiniBarChart
                  data={stats.most_checked_drugs}
                  max={stats.most_checked_drugs[0]?.count ?? 1}
                  color="bg-violet-500"
                />
              )}
            </div>

            {/* Sessions by month */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 lg:col-span-2">
              <h3 className="font-bold text-gray-800 mb-5 flex items-center gap-2">
                <TrendingUp size={16} className="text-blue-500" /> Check Sessions by Month
              </h3>
              {stats.sessions_by_month.length === 0 ? (
                <p className="text-sm text-gray-400">No data available</p>
              ) : (
                <div className="flex items-end gap-2 h-32">
                  {(() => {
                    const maxC = Math.max(...stats.sessions_by_month.map(m => m.count), 1);
                    return stats.sessions_by_month.map(m => (
                      <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                        <span className="text-xs text-gray-500">{m.count}</span>
                        <div className="w-full bg-violet-500 rounded-t" style={{ height: `${Math.max(8,(m.count/maxC)*96)}px` }} />
                        <span className="text-[10px] text-gray-400 whitespace-nowrap">{m.month}</span>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>

            {/* Info panel */}
            <div className="bg-gradient-to-br from-violet-50 to-indigo-50 rounded-2xl border border-violet-100 p-6 lg:col-span-2">
              <div className="flex items-start gap-3">
                <Info size={16} className="text-violet-500 mt-0.5 shrink-0" />
                <div className="text-sm text-violet-700">
                  <strong>About statistics:</strong> Data aggregated from all saved check sessions.
                  Interaction data based on DrugBank® v5 — 24,386+ classified interaction pairs.
                  For academic reference only. Does not replace professional clinical advice.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════ TAB: COMPARE ═══════════════════ */}
        {activeTab === 'compare' && <DrugComparePanel />}
      </div>

      {/* Edit modal */}
      {editingSession && (
        <EditModal
          session={editingSession}
          onClose={() => setEditingSession(null)}
          onSave={updateSession}
        />
      )}

      {/* Session detail modal — opens when clicking session title */}
      {openSession && (
        <SessionDetailModal
          session={openSession}
          onClose={() => setOpenSession(null)}
        />
      )}

      {/* Legacy single-interaction modal (kept for compatibility) */}
      {selectedInteraction && (
        <InteractionDetailModal
          ix={selectedInteraction}
          onClose={() => setSelectedInteraction(null)}
        />
      )}
    </div>
  );
}

// ── Drug Compare Panel ────────────────────────────────────────────────────

import { getDrugs } from '../lib/drugCache';
import type { Drug } from '../types/drug';

function DrugComparePanel() {
  const [query, setQuery] = useState<[string, string]>(['', '']);
  const [suggestions, setSuggestions] = useState<[Drug[], Drug[]]>([[], []]);
  const [selected, setSelected] = useState<[Drug | null, Drug | null]>([null, null]);
  const [allDrugs, setAllDrugs] = useState<Drug[]>([]);

  useEffect(() => { getDrugs().then(setAllDrugs); }, []);

  const search = useCallback((idx: 0 | 1, val: string) => {
    const q2: [string, string] = [...query] as [string, string];
    q2[idx] = val;
    setQuery(q2);
    if (val.length < 2) { const s2: [Drug[], Drug[]] = [...suggestions] as [Drug[], Drug[]]; s2[idx] = []; setSuggestions(s2); return; }
    const hits = allDrugs.filter(d => d.name.toLowerCase().includes(val.toLowerCase())).slice(0, 6);
    const s2: [Drug[], Drug[]] = [...suggestions] as [Drug[], Drug[]]; s2[idx] = hits; setSuggestions(s2);
  }, [query, suggestions, allDrugs]);

  const pick = (idx: 0 | 1, drug: Drug) => {
    const sel: [Drug | null, Drug | null] = [...selected] as [Drug | null, Drug | null];
    sel[idx] = drug;
    setSelected(sel);
    const q2: [string, string] = [...query] as [string, string];
    q2[idx] = drug.name;
    setQuery(q2);
    const s2: [Drug[], Drug[]] = [...suggestions] as [Drug[], Drug[]]; s2[idx] = []; setSuggestions(s2);
  };

  const d1 = selected[0], d2 = selected[1];

  const rows: { label: string; key: keyof Drug }[] = [
    { label: 'Name', key: 'name' },
    { label: 'Type', key: 'type' },
    { label: 'Groups', key: 'groups' },
    { label: 'Status', key: 'state' },
    { label: 'Formula', key: 'molecular_formula' },
    { label: 'Mol. Weight', key: 'molecular_weight' },
    { label: 'Indication', key: 'indication' },
    { label: 'Mechanism', key: 'mechanism' },
    { label: 'Target Proteins', key: 'targets' },
    { label: 'Enzymes', key: 'enzymes' },
    { label: 'Transporters', key: 'transporters' },
  ];

  return (
    <div>
      <div className="mb-6">
        <h2 className="font-bold text-gray-800 text-lg mb-1">Drug Comparison</h2>
        <p className="text-sm text-gray-500">Select 2 drugs to compare pharmacological parameters from the database.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 mb-6">
        {([0, 1] as const).map(idx => (
          <div key={idx} className="relative">
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              {idx === 0 ? 'First Drug' : 'Second Drug'}
            </label>
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus-within:border-violet-400 shadow-sm transition-colors">
              <Pill size={14} className="text-gray-400 shrink-0" />
              <input value={query[idx]} onChange={e => search(idx, e.target.value)}
                placeholder="Search drug name..."
                className="flex-1 text-sm outline-none text-gray-700" autoComplete="off" />
              {selected[idx] && <button onClick={() => { const sel: [Drug|null, Drug|null] = [...selected] as any; sel[idx] = null; setSelected(sel); const q2: [string,string] = [...query] as any; q2[idx]=''; setQuery(q2); }}><X size={13} className="text-gray-400" /></button>}
            </div>
            {suggestions[idx].length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-20 overflow-hidden">
                {suggestions[idx].map(d => (
                  <button key={d.id} onMouseDown={() => pick(idx, d)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-violet-50 text-left transition-colors border-b border-gray-50 last:border-0">
                    <Pill size={12} className="text-violet-400 shrink-0" />
                    <span className="text-sm text-gray-700">{d.name}</span>
                    <span className="text-xs text-gray-400 ml-auto">{d.groups?.[0] ?? d.type ?? ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {d1 && d2 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-3 bg-gradient-to-r from-violet-900 to-indigo-900 text-white">
            <div className="px-5 py-4 border-r border-white/10 text-xs font-semibold uppercase tracking-wide text-violet-200">Parameters</div>
            <div className="px-5 py-4 border-r border-white/10">
              <div className="font-bold text-sm truncate">{d1.name}</div>
              <div className="text-violet-300 text-xs mt-0.5">{d1.id}</div>
            </div>
            <div className="px-5 py-4">
              <div className="font-bold text-sm truncate">{d2.name}</div>
              <div className="text-violet-300 text-xs mt-0.5">{d2.id}</div>
            </div>
          </div>
          {rows.map((row, i) => {
            const v1 = String(d1[row.key] ?? '—');
            const v2 = String(d2[row.key] ?? '—');
            const same = v1 === v2 && v1 !== '—';
            return (
              <div key={row.key} className={`grid grid-cols-3 border-b border-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                <div className="px-5 py-3 text-xs font-semibold text-gray-500 border-r border-gray-100">{row.label}</div>
                <div className={`px-5 py-3 text-xs text-gray-700 border-r border-gray-100 ${same ? 'text-green-600' : ''}`}>
                  {v1.length > 120 ? v1.slice(0, 120) + '…' : v1}
                </div>
                <div className={`px-5 py-3 text-xs text-gray-700 ${same ? 'text-green-600' : ''}`}>
                  {v2.length > 120 ? v2.slice(0, 120) + '…' : v2}
                </div>
              </div>
            );
          })}
          <div className="grid grid-cols-2 gap-3 p-5 border-t border-gray-100">
            <Link to={`/drugs/${d1.id}`}
              className="flex items-center justify-center gap-1.5 text-sm font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 py-2.5 rounded-xl transition-colors">
              View details {d1.name} <ArrowRight size={13} />
            </Link>
            <Link to={`/drugs/${d2.id}`}
              className="flex items-center justify-center gap-1.5 text-sm font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 py-2.5 rounded-xl transition-colors">
              View details {d2.name} <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      ) : (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
          <div className="w-14 h-14 bg-violet-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Activity size={24} className="text-violet-300" />
          </div>
          <p className="text-gray-400 text-sm">Select 2 drugs above to view comparison table</p>
        </div>
      )}
    </div>
  );
}
