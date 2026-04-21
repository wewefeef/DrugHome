import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Pill, ChevronRight, Zap, FlaskConical, BookOpen,
  ExternalLink, Tag, Loader2, Activity, AlertTriangle,
  Beaker, Droplets, Clock, Shield, ArrowDownUp,
} from 'lucide-react';
import type { Drug } from '../types/drug';
import { apiFetchDrug, apiFetchDrugInteractions, type DrugInteraction } from '../lib/api';

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Drug-Protein Network SVG (detail page version)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function DrugNetworkSVG({ name, drugId, targets, enzymes, transporters }: {
  name: string; drugId: string; targets: number; enzymes: number; transporters: number;
}) {
  const W = 560, H = 280;
  const cx = W / 2, cy = H / 2;
  const R = 100;
  const seed = parseInt(drugId.replace('DB', ''), 10) || 1;
  const angleOffset = (seed % 360) * (Math.PI / 180);

  type NodeType = 'target' | 'enzyme' | 'transporter';
  const nodeData: { type: NodeType }[] = [
    ...Array.from({ length: Math.min(targets, 6) }, () => ({ type: 'target' as NodeType })),
    ...Array.from({ length: Math.min(enzymes, 4) }, () => ({ type: 'enzyme' as NodeType })),
    ...Array.from({ length: Math.min(transporters, 3) }, () => ({ type: 'transporter' as NodeType })),
  ];
  const nodes = nodeData.map((nd, i) => {
    const base = (i / Math.max(nodeData.length, 1)) * 2 * Math.PI + angleOffset;
    const jitter = ((seed * (i + 3)) % 18 - 9) * (Math.PI / 180);
    const rr = R + ((seed * (i + 2)) % 20 - 10);
    return { ...nd, x: cx + rr * Math.cos(base + jitter), y: cy + rr * Math.sin(base + jitter), idx: i };
  });
  const colorMap = {
    target:      { stroke: '#10b981', fill: '#022c22', text: '#34d399', label: 'Target' },
    enzyme:      { stroke: '#f59e0b', fill: '#451a03', text: '#fbbf24', label: 'Enzyme' },
    transporter: { stroke: '#a78bfa', fill: '#2e1065', text: '#c4b5fd', label: 'Transporter' },
  };
  const labelOf = (_type: NodeType, i: number) => {
    const n = ((seed * (i + 7)) % 888) + 11;
    return 'P#' + n;
  };
  const gradId = `grad-${drugId}`;
  const shortName = name.length > 22 ? name.slice(0, 19) + '...' : name;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block rounded-xl">
      <defs>
        <radialGradient id={gradId} cx="40%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#0d2137" />
          <stop offset="100%" stopColor="#060c17" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} rx="12" fill={`url(#${gradId})`} />
      {Array.from({ length: 18 }).map((_, i) =>
        Array.from({ length: 10 }).map((_, j) => (
          <circle key={`d-${i}-${j}`} cx={i * 33 + 5} cy={j * 30 + 5} r="0.8" fill="#1e3a5f" opacity="0.25" />
        ))
      )}
      {nodes.map((node, i) => {
        const c = colorMap[node.type];
        return <line key={`e-${i}`} x1={cx} y1={cy} x2={node.x} y2={node.y}
          stroke={c.stroke} strokeWidth="1.5" strokeDasharray="6,3" opacity="0.65" />;
      })}
      {nodes.map((node, i) => {
        const c = colorMap[node.type];
        return (
          <g key={`n-${i}`}>
            <rect x={node.x - 22} y={node.y - 13} width="44" height="26" rx="6"
              fill={c.fill} stroke={c.stroke} strokeWidth="1.5" />
            <text x={node.x} y={node.y + 5} textAnchor="middle" fontSize="9"
              fill={c.text} fontWeight="700" fontFamily="monospace">{labelOf(node.type, i)}</text>
          </g>
        );
      })}
      <ellipse cx={cx} cy={cy} rx="60" ry="26" fill="#1e3a8a" stroke="#3b82f6" strokeWidth="2.5" />
      <text x={cx} y={cy + 5} textAnchor="middle" fontSize="10" fill="#93c5fd"
        fontWeight="800" fontFamily="system-ui, sans-serif">{shortName}</text>
      <g transform={`translate(12,${H - 22})`}>
        {[
          { fill: '#022c22', stroke: '#10b981', text: '#6ee7b7', label: `Targets (${targets})`, x: 0 },
          { fill: '#451a03', stroke: '#f59e0b', text: '#fbbf24', label: `Enzymes (${enzymes})`, x: 95 },
          { fill: '#2e1065', stroke: '#a78bfa', text: '#c4b5fd', label: `Transporters (${transporters})`, x: 190 },
        ].map(({ fill, stroke, text, label, x }) => (
          <g key={label} transform={`translate(${x},0)`}>
            <rect x="0" y="-6" width="9" height="9" rx="2" fill={fill} stroke={stroke} strokeWidth="1" />
            <text x="13" y="4" fontSize="8" fill={text}>{label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

const statusBadge: Record<string, string> = {
  approved: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  investigational: 'bg-sky-100 text-sky-700 border border-sky-200',
  experimental: 'bg-purple-100 text-purple-700 border border-purple-200',
  withdrawn: 'bg-red-100 text-red-700 border border-red-200',
};

// ────────────────────────────────────────────────────────────────────
// Chemical Structure viewer — fetches 2D structure from PubChem
// ────────────────────────────────────────────────────────────────────
function ChemStructure({ smiles, inchikey, name }: { smiles: string; inchikey: string; name: string }) {
  const [imgStatus, setImgStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  // Prefer InChIKey (stable identifier), fall back to SMILES
  const src = inchikey
    ? `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/inchikey/${encodeURIComponent(inchikey)}/PNG?image_size=400x300`
    : smiles
    ? `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles)}/PNG?image_size=400x300`
    : null;

  if (!src) return null;

  return (
    <div className="card p-6">
      <h2 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
        <Beaker size={18} className="text-violet-600" /> Chemical Structure
      </h2>
      <div className="flex justify-center items-center min-h-[200px] bg-white rounded-xl border border-gray-100 p-4 relative overflow-hidden">
        {imgStatus === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
            <Loader2 size={28} className="animate-spin text-violet-400" />
          </div>
        )}
        {imgStatus === 'error' && (
          <div className="flex flex-col items-center gap-2 text-gray-400 text-sm py-6">
            <Beaker size={32} className="opacity-30" />
            <span>Structure image not available</span>
          </div>
        )}
        <img
          src={src}
          alt={`2D chemical structure of ${name}`}
          className={`max-w-full max-h-72 object-contain rounded-lg ${imgStatus === 'ok' ? '' : 'invisible absolute'}`}
          style={{ background: 'white' }}
          onLoad={() => setImgStatus('ok')}
          onError={() => setImgStatus('error')}
        />
      </div>
      <p className="text-xs text-gray-400 text-center mt-2">
        2D structure · Source: <a href="https://pubchem.ncbi.nlm.nih.gov" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600">PubChem</a>
      </p>
    </div>
  );
}

const severityBadge: Record<string, string> = {
  major:    'bg-red-100 text-red-700 border border-red-200',
  moderate: 'bg-amber-100 text-amber-700 border border-amber-200',
  minor:    'bg-green-100 text-green-700 border border-green-200',
  unknown:  'bg-gray-100 text-gray-600 border border-gray-200',
};

export default function DrugDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [drug, setDrug] = useState<Drug | null | undefined>(undefined); // undefined = loading
  const [interactions, setInteractions] = useState<DrugInteraction[]>([]);
  const [interactionTotal, setInteractionTotal] = useState(0);
  const [interactionsLoading, setInteractionsLoading] = useState(false);

  useEffect(() => {
    if (!id) { setDrug(null); return; }
    apiFetchDrug(id).then(drug => setDrug(drug));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setInteractionsLoading(true);
    apiFetchDrugInteractions(id, 1, 10)
      .then(res => { setInteractions(res.items); setInteractionTotal(res.total); })
      .catch(() => {})
      .finally(() => setInteractionsLoading(false));
  }, [id]);

  // Loading
  if (drug === undefined) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
        <Loader2 size={48} className="text-primary-300 animate-spin" />
        <p className="text-gray-500 font-medium">Loading drug information...</p>
      </div>
    );
  }

  // Not found
  if (!drug) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
        <Pill size={64} className="text-gray-200" />
        <h2 className="text-xl font-bold text-gray-600">Drug not found</h2>
        <p className="text-gray-400 text-sm">DrugBank ID: <span className="font-mono">{id}</span></p>
        <Link to="/drugs" className="btn-primary mt-2">← Back to drug list</Link>
      </div>
    );
  }

  const primaryGroup = drug.groups.find(g => ['approved', 'investigational', 'experimental', 'withdrawn'].includes(g)) || drug.groups[0] || '';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* â”€â”€ Header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="bg-gradient-to-r from-primary-950 via-primary-900 to-primary-800 text-white py-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center gap-2 text-blue-300 text-sm mb-4">
            <Link to="/" className="hover:text-white transition-colors">Home</Link>
            <ChevronRight size={14} />
            <Link to="/drugs" className="hover:text-white transition-colors">Drugs</Link>
            <ChevronRight size={14} />
            <span className="text-white font-medium truncate max-w-xs">{drug.name}</span>
          </div>
          <div className="flex items-start gap-5">
            <div className="w-16 h-16 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
              <Pill size={32} className="text-blue-200" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-3xl font-extrabold mb-1 leading-tight">{drug.name}</h1>
              <p className="text-blue-300 text-base mb-3 italic leading-snug">{drug.generic_name}</p>
              <div className="flex flex-wrap gap-2">
                {primaryGroup && (
                  <span className={`text-xs font-semibold px-3 py-1 rounded-full ${statusBadge[primaryGroup] || 'bg-white/10 text-blue-200 border border-white/20'}`}>
                  {primaryGroup === 'approved' ? '✓ ' : ''}{primaryGroup}
                  </span>
                )}
                <span className="bg-white/10 border border-white/20 text-orange-200 text-xs font-semibold px-3 py-1 rounded-full capitalize">{drug.type}</span>
                {drug.state && <span className="bg-white/10 border border-white/20 text-blue-200 text-xs px-3 py-1 rounded-full capitalize">{drug.state}</span>}
                <span className="font-mono bg-white/5 border border-white/10 text-blue-300 text-xs px-3 py-1 rounded-full">{drug.id}</span>
                <span className="font-mono bg-white/5 border border-white/10 text-slate-400 text-xs px-3 py-1 rounded-full">{drug.drug_code}</span>
              </div>
              {drug.atc_codes.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {drug.atc_codes.slice(0, 4).map(a => (
                    <span key={a} className="bg-blue-900/50 text-blue-200 text-[10px] font-mono px-2 py-0.5 rounded border border-blue-700/50">{a}</span>
                  ))}
                </div>
              )}
            </div>
            <a href={`https://www.drugbank.ca/drugs/${drug.id}`} target="_blank" rel="noopener noreferrer"
              className="hidden md:flex items-center gap-1.5 text-blue-300 hover:text-white text-xs font-medium shrink-0 transition-colors border border-white/20 px-3 py-1.5 rounded-lg hover:bg-white/10">
              <ExternalLink size={12} /> DrugBank.ca
            </a>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* â”€â”€ Network SVG + Protein stats â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-950 rounded-2xl border border-slate-700/50 shadow-xl overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-slate-700/50 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Activity size={16} className="text-blue-400" />
              <h2 className="font-bold text-white text-sm">Protein Interaction Network</h2>
            </div>
            <div className="flex items-center gap-3 text-xs font-semibold">
              {drug.targets > 0 && (
                <span className="flex items-center gap-1 bg-emerald-900/40 text-emerald-300 border border-emerald-700/50 px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />{drug.targets} Targets
                </span>
              )}
              {drug.enzymes > 0 && (
                <span className="flex items-center gap-1 bg-amber-900/40 text-amber-300 border border-amber-700/50 px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />{drug.enzymes} Enzymes
                </span>
              )}
              {drug.transporters > 0 && (
                <span className="flex items-center gap-1 bg-violet-900/40 text-violet-300 border border-violet-700/50 px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />{drug.transporters} Transporters
                </span>
              )}
            </div>
          </div>
          <div className="p-4">
            <DrugNetworkSVG
              name={drug.name} drugId={drug.id}
              targets={drug.targets} enzymes={drug.enzymes} transporters={drug.transporters}
            />
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* â”€â”€ Main content â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          <div className="lg:col-span-2 space-y-5">

            {/* Chemical Properties Table */}
            {(drug.molecular_formula || drug.smiles || drug.inchikey) && (
              <div className="card p-6">
                <h2 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <FlaskConical size={18} className="text-violet-600" /> Chemical Properties
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-gray-100">
                      {[
                        { label: 'Molecular Formula', value: drug.molecular_formula, mono: true },
                        { label: 'Molecular Weight', value: drug.molecular_weight ? `${Number(drug.molecular_weight).toFixed(4)} g/mol` : '', mono: false },
                        { label: 'SMILES', value: drug.smiles, mono: true, truncate: true },
                        { label: 'InChIKey', value: drug.inchikey, mono: true },
                      ].filter(r => r.value).map(row => (
                        <tr key={row.label} className="hover:bg-gray-50 transition-colors">
                          <td className="py-2.5 pr-4 text-gray-500 font-medium w-44 text-xs uppercase tracking-wide whitespace-nowrap">{row.label}</td>
                          <td className={`py-2.5 text-gray-800 ${row.mono ? 'font-mono text-xs' : ''} ${row.truncate ? 'max-w-xs truncate' : ''}`}
                            title={row.truncate ? String(row.value) : undefined}>
                            {row.value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Chemical Structure */}
            {(drug.smiles || drug.inchikey) && (
              <ChemStructure smiles={drug.smiles} inchikey={drug.inchikey} name={drug.name} />
            )}

            {/* Description */}
            {drug.description && (
              <div className="card p-6">
                <h2 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <BookOpen size={18} className="text-primary-700" /> Description
                </h2>
                <p className="text-gray-600 leading-relaxed text-sm">{drug.description}</p>
              </div>
            )}

            {/* Indication */}
            {drug.indication && (
              <div className="card p-6">
                <h2 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <Tag size={18} className="text-blue-600" /> Indication
                </h2>
                <p className="text-gray-600 leading-relaxed text-sm">{drug.indication}</p>
              </div>
            )}

            {/* Mechanism */}
            {drug.mechanism && (
              <div className="card p-6">
                <h2 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <Zap size={18} className="text-amber-600" /> Mechanism of Action
                </h2>
                <p className="text-gray-600 leading-relaxed text-sm">{drug.mechanism}</p>
              </div>
            )}

            {/* Pharmacodynamics */}
            {drug.pharmacodynamics && (
              <div className="card p-6">
                <h2 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <Activity size={18} className="text-blue-600" /> Pharmacodynamics
                </h2>
                <p className="text-gray-600 leading-relaxed text-sm">{drug.pharmacodynamics}</p>
              </div>
            )}

            {/* Absorption */}
            {drug.absorption && (
              <div className="card p-6">
                <h2 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <Droplets size={18} className="text-cyan-600" /> Absorption
                </h2>
                <p className="text-gray-600 leading-relaxed text-sm">{drug.absorption}</p>
              </div>
            )}

            {/* Metabolism */}
            {drug.metabolism && (
              <div className="card p-6">
                <h2 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <FlaskConical size={18} className="text-emerald-600" /> Metabolism
                </h2>
                <p className="text-gray-600 leading-relaxed text-sm">{drug.metabolism}</p>
              </div>
            )}

            {/* Toxicity */}
            {drug.toxicity && (
              <div className="card p-6">
                <h2 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <AlertTriangle size={18} className="text-red-600" /> Toxicity
                </h2>
                <p className="text-gray-600 leading-relaxed text-sm">{drug.toxicity}</p>
              </div>
            )}

            {/* Drug-Drug Interactions */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-gray-900 flex items-center gap-2">
                  <AlertTriangle size={18} className="text-red-500" /> Drug Interactions
                  {interactionTotal > 0 && (
                    <span className="ml-1 text-xs font-normal text-gray-400">({interactionTotal.toLocaleString()} known)</span>
                  )}
                </h2>
                {interactionTotal > 10 && (
                  <Link to="/interactions" className="text-xs text-primary-600 hover:text-primary-800 font-medium">
                    Check interactions →
                  </Link>
                )}
              </div>
              {interactionsLoading ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
                  <Loader2 size={16} className="animate-spin" /> Loading interactions...
                </div>
              ) : interactions.length === 0 ? (
                <p className="text-gray-400 text-sm py-2">No known drug-drug interactions recorded.</p>
              ) : (
                <div className="space-y-2">
                  {interactions.map(ix => (
                    <div key={ix.id} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                      <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize mt-0.5 ${severityBadge[ix.severity?.toLowerCase() ?? 'unknown'] ?? severityBadge.unknown}`}>
                        {ix.severity ?? 'unknown'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {ix.interacting_drug_name ?? ix.interacting_drug_id}
                          <span className="ml-1.5 font-mono text-xs text-gray-400">{ix.interacting_drug_id}</span>
                        </p>
                        {ix.description && (
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{ix.description}</p>
                        )}
                      </div>
                    </div>
                  ))}
                  {interactionTotal > 10 && (
                    <p className="text-xs text-gray-400 text-center pt-1">
                      Showing 10 of {interactionTotal.toLocaleString()} interactions.{' '}
                      <Link to="/interactions" className="text-primary-600 hover:underline">Use the Interactions page</Link> to check a full prescription.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* â”€â”€ Sidebar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          <div className="space-y-5">
            {/* Quick info */}
            <div className="card p-5">
              <h3 className="font-bold text-gray-900 mb-4 text-sm">Quick Info</h3>
              <div className="space-y-3 text-sm">
                {[
                  { label: 'DrugBank ID', value: drug.id, mono: true },
                  { label: 'Drug Code', value: drug.drug_code, mono: true },
                  { label: 'Generic Name', value: drug.generic_name },
                  { label: 'Type', value: drug.type, capitalize: true },
                  { label: 'State', value: drug.state, capitalize: true },
                ].filter(i => i.value).map(item => (
                  <div key={item.label} className="flex justify-between gap-2">
                    <span className="text-gray-500 shrink-0">{item.label}</span>
                    <span className={`font-medium text-gray-800 text-right truncate ${item.mono ? 'font-mono text-primary-700 text-xs' : ''} ${item.capitalize ? 'capitalize' : ''}`}>
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
              <a href={`https://www.drugbank.ca/drugs/${drug.id}`}
                target="_blank" rel="noopener noreferrer"
                className="mt-4 flex items-center gap-2 text-primary-700 text-sm font-medium hover:text-primary-900 transition-colors">
                <ExternalLink size={14} /> View on DrugBank.ca
              </a>
            </div>

            {/* Pharmacokinetics summary card */}
            {(drug.half_life || drug.protein_binding || drug.route_of_elimination) && (
              <div className="card p-5">
                <h3 className="font-bold text-gray-900 mb-3 text-sm flex items-center gap-2">
                  <Clock size={15} className="text-cyan-600" /> Pharmacokinetics
                </h3>
                <div className="space-y-3 text-sm">
                  {drug.half_life && (
                    <div>
                      <div className="flex items-center gap-1.5 text-gray-500 mb-0.5">
                        <Clock size={12} className="text-cyan-500" />
                        <span className="text-xs font-medium uppercase tracking-wide">Half-life</span>
                      </div>
                      <p className="text-gray-700 text-xs leading-relaxed line-clamp-3">{drug.half_life}</p>
                    </div>
                  )}
                  {drug.protein_binding && (
                    <div>
                      <div className="flex items-center gap-1.5 text-gray-500 mb-0.5">
                        <Shield size={12} className="text-purple-500" />
                        <span className="text-xs font-medium uppercase tracking-wide">Protein Binding</span>
                      </div>
                      <p className="text-gray-700 text-xs leading-relaxed line-clamp-3">{drug.protein_binding}</p>
                    </div>
                  )}
                  {drug.route_of_elimination && (
                    <div>
                      <div className="flex items-center gap-1.5 text-gray-500 mb-0.5">
                        <ArrowDownUp size={12} className="text-emerald-500" />
                        <span className="text-xs font-medium uppercase tracking-wide">Route of Elimination</span>
                      </div>
                      <p className="text-gray-700 text-xs leading-relaxed line-clamp-3">{drug.route_of_elimination}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Groups / Status */}
            <div className="card p-5">
              <h3 className="font-bold text-gray-900 mb-3 text-sm">Approval Status</h3>
              <div className="flex flex-wrap gap-2">
                {drug.groups.map(g => (
                  <span key={g} className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${statusBadge[g] || 'bg-gray-100 text-gray-600 border border-gray-200'}`}>{g}</span>
                ))}
              </div>
            </div>

            {/* Protein interaction stats */}
            {(drug.targets + drug.enzymes + drug.transporters) > 0 && (
              <div className="card p-5">
                <h3 className="font-bold text-gray-900 mb-3 text-sm flex items-center gap-2">
                  <FlaskConical size={15} className="text-emerald-600" /> Protein Interactions
                </h3>
                <div className="space-y-2.5">
                  {[
                    { label: 'Targets', count: drug.targets, dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200' },
                    { label: 'Enzymes', count: drug.enzymes, dot: 'bg-amber-400', bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200' },
                    { label: 'Transporters', count: drug.transporters, dot: 'bg-violet-400', bg: 'bg-violet-50', text: 'text-violet-800', border: 'border-violet-200' },
                  ].filter(s => s.count > 0).map(s => (
                    <div key={s.label} className={`flex items-center justify-between px-3 py-2 rounded-lg border ${s.bg} ${s.border}`}>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                        <span className={`text-sm font-medium ${s.text}`}>{s.label}</span>
                      </div>
                      <span className={`font-bold text-sm ${s.text}`}>{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Categories */}
            {drug.categories.length > 0 && (
              <div className="card p-5">
                <h3 className="font-bold text-gray-900 mb-3 text-sm">ATC Classification</h3>
                <div className="flex flex-wrap gap-1.5">
                  {drug.categories.map(c => (
                    <span key={c} className="bg-primary-50 text-primary-700 border border-primary-100 text-xs px-2.5 py-1 rounded-full">{c}</span>
                  ))}
                </div>
              </div>
            )}

            {/* ATC Codes */}
            {drug.atc_codes.length > 0 && (
              <div className="card p-5">
                <h3 className="font-bold text-gray-900 mb-3 text-sm">ATC Codes</h3>
                <div className="flex flex-wrap gap-1.5">
                  {drug.atc_codes.map(a => (
                    <span key={a} className="font-mono bg-slate-50 border border-slate-200 text-slate-600 text-xs px-2.5 py-1 rounded-md">{a}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Aliases */}
            {drug.aliases.length > 0 && (
              <div className="card p-5">
                <h3 className="font-bold text-gray-900 mb-3 text-sm">Aliases</h3>
                <div className="space-y-1">
                  {drug.aliases.slice(0, 8).map(a => (
                    <p key={a} className="text-xs text-gray-600 leading-relaxed">{a}</p>
                  ))}
                  {drug.aliases.length > 8 && (
                    <p className="text-xs text-gray-400 italic">+{drug.aliases.length - 8} more aliases</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
