import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BarChart2, ChevronRight, X, Zap, AlertTriangle, CheckCircle2,
  Info, Clock, Trash2, Tag, FileText, Search, TrendingUp, Shield,
  Pill, FlaskConical, Activity, ChevronDown, ChevronUp, Edit3, Save,
  RefreshCw, Database, Star, ArrowRight, LayoutDashboard,
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
  major:    { bg: 'bg-red-50 border-red-200',    text: 'text-red-700',    dot: 'bg-red-500',    label: 'Nguy hiểm cao' },
  moderate: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700',  dot: 'bg-amber-400',  label: 'Trung bình' },
  minor:    { bg: 'bg-green-50 border-green-200', text: 'text-green-700',  dot: 'bg-green-500',  label: 'Thấp' },
  unknown:  { bg: 'bg-green-50 border-green-200', text: 'text-green-700',  dot: 'bg-green-500',  label: 'Thấp' },
};
const normSev = (s: string) => (['major','moderate','minor'].includes(s) ? s as keyof typeof SEV : 'minor');

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function fmtDateShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' });
}

// ── Sub-components ─────────────────────────────────────────────────────────

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

function SessionCard({ session, onDelete, onEdit, onExpand, expanded }: {
  session: Session;
  onDelete: (id: number) => void;
  onEdit: (session: Session) => void;
  onExpand: (id: number) => void;
  expanded: boolean;
}) {
  const tags = session.tags ? session.tags.split('|').filter(Boolean) : [];
  const riskColor = session.major_count > 0 ? 'border-l-red-500'
    : session.moderate_count > 0 ? 'border-l-amber-400'
    : 'border-l-green-500';

  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm border-l-4 ${riskColor} transition-all`}>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-800 text-sm truncate">{session.title}</h3>
              {session.major_count > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                  <AlertTriangle size={9} /> {session.major_count} nguy hiểm
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
              <span className="flex items-center gap-1"><Clock size={10} />{fmtDateShort(session.created_at)}</span>
              <span className="flex items-center gap-1"><Pill size={10} />{session.total_drugs} thuốc</span>
              <span className="flex items-center gap-1"><Zap size={10} />{session.total_interactions} tương tác</span>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tags.map(t => (
                  <span key={t} className="text-[10px] bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full">{t}</span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => onEdit(session)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
              <Edit3 size={14} />
            </button>
            <button onClick={() => onDelete(session.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
              <Trash2 size={14} />
            </button>
            <button onClick={() => onExpand(session.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary-700 hover:bg-primary-50 transition-colors">
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>

        {/* Drug pills */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {(session.drugs_snapshot ?? []).map(d => (
            <Link key={d.id} to={`/drugs/${d.id}`}
              className="text-[11px] bg-primary-50 text-primary-700 border border-primary-100 px-2.5 py-0.5 rounded-full hover:bg-primary-100 transition-colors font-medium">
              {d.name}
            </Link>
          ))}
        </div>
      </div>

      {/* Expanded interactions */}
      {expanded && session.interactions_found && session.interactions_found.length > 0 && (
        <div className="border-t border-gray-50 divide-y divide-gray-50">
          {session.interactions_found.map((ix, i) => {
            const s = SEV[normSev(ix.severity)];
            return (
              <div key={i} className="px-5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-xs text-gray-700 truncate">{ix.drug_a_name}</span>
                    <ArrowRight size={10} className="text-gray-300 shrink-0" />
                    <span className="font-semibold text-xs text-gray-700 truncate">{ix.drug_b_name}</span>
                  </div>
                  <RiskBadge sev={ix.severity} />
                </div>
                {ix.description && (
                  <p className="text-xs text-gray-400 mt-1 line-clamp-2">{ix.description}</p>
                )}
              </div>
            );
          })}
          {session.interactions_found.length === 0 && (
            <div className="px-5 py-3 text-xs text-gray-400 flex items-center gap-2">
              <CheckCircle2 size={12} className="text-green-500" />
              Không phát hiện tương tác đáng lo ngại
            </div>
          )}
        </div>
      )}
      {expanded && (!session.interactions_found || session.interactions_found.length === 0) && (
        <div className="border-t border-gray-50 px-5 py-3 text-xs text-gray-400 flex items-center gap-2">
          <CheckCircle2 size={12} className="text-green-500" />
          Không phát hiện tương tác đáng lo ngại
        </div>
      )}
    </div>
  );
}

// ── Edit Modal ─────────────────────────────────────────────────────────────

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
          <h2 className="font-bold text-gray-800">Chỉnh sửa phiên</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Tên phiên</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Nhãn (phân cách bằng |)</label>
            <input value={tags} onChange={e => setTags(e.target.value)}
              placeholder="Cardiology|ICU|Tiểu đường" 
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Ghi chú lâm sàng</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="Ghi chú về bệnh nhân, bối cảnh lâm sàng..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-400 resize-none" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">Hủy</button>
          <button onClick={() => { onSave(session.id, title, tags, notes); onClose(); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary-800 text-white text-sm font-semibold rounded-xl hover:bg-primary-700 transition-colors">
            <Save size={14} /> Lưu
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
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [activeTab, setActiveTab] = useState<'history' | 'stats' | 'compare'>('history');
  const [backendOk, setBackendOk] = useState(true);
  const navigate = useNavigate();

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sRes, stRes] = await Promise.all([
        fetch(`/api/v1/sessions?limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}${filterTag ? `&tag=${encodeURIComponent(filterTag)}` : ''}`),  
        fetch('/api/v1/sessions/stats'),
      ]);
      if (!sRes.ok || !stRes.ok) throw new Error('Backend không phản hồi');
      setSessions(await sRes.json());
      setStats(await stRes.json());
      setBackendOk(true);
    } catch {
      setBackendOk(false);
      setError('Không kết nối được máy chủ backend.');
    } finally {
      setLoading(false);
    }
  }, [search, filterTag]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const deleteSession = async (id: number) => {
    if (!confirm('Xóa phiên này?')) return;
    await fetch(`/api/v1/sessions/${id}`, { method: 'DELETE' });
    setSessions(prev => prev.filter(s => s.id !== id));
    if (stats) setStats({ ...stats, total_sessions: stats.total_sessions - 1 });
  };

  const updateSession = async (id: number, title: string, tags: string, notes: string) => {
    const res = await fetch(`/api/v1/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, tags, notes }),
    });
    if (res.ok) {
      const updated = await res.json();
      setSessions(prev => prev.map(s => s.id === id ? updated : s));
    }
  };

  const toggleExpand = (id: number) => setExpandedId(prev => prev === id ? null : id);

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
                <Link to="/" className="hover:text-white transition-colors">Trang chủ</Link>
                <ChevronRight size={14} />
                <span className="text-white font-medium">Công cụ phân tích</span>
              </nav>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2.5 bg-white/10 rounded-xl backdrop-blur-sm">
                  <BarChart2 size={26} className="text-violet-200" />
                </div>
                <h1 className="text-3xl font-bold">Phân tích & Lịch sử tương tác</h1>
              </div>
              <p className="text-violet-200 text-sm max-w-xl">
                Lưu trữ vĩnh viễn các phiên kiểm tra tương tác thuốc, phân loại theo nhóm bệnh lý, và theo dõi xu hướng lâm sàng.
              </p>
            </div>
            <button onClick={() => navigate('/interactions')}
              className="shrink-0 flex items-center gap-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/20 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all">
              <Zap size={15} className="text-amber-300" />
              Kiểm tra tương tác mới
            </button>
          </div>

          {/* Quick stats row */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-8">
              {[
                { label: 'Phiên lưu', value: stats.total_sessions, icon: <Database size={16} />, color: 'text-violet-300' },
                { label: 'Tương tác kiểm tra', value: stats.total_interactions_checked, icon: <Zap size={16} />, color: 'text-amber-300' },
                { label: 'Cặp nguy hiểm cao', value: stats.total_major, icon: <AlertTriangle size={16} />, color: 'text-red-300' },
                { label: 'Cặp trung bình', value: stats.total_moderate, icon: <Shield size={16} />, color: 'text-orange-300' },
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

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 sticky top-[104px] z-30">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-0.5">
            {([
              { id: 'history', label: 'Lịch sử phiên', icon: <Clock size={14} /> },
              { id: 'stats', label: 'Thống kê', icon: <TrendingUp size={14} /> },
              { id: 'compare', label: 'So sánh thuốc', icon: <Activity size={14} /> },
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
              <strong>Backend chưa kết nối.</strong> Dữ liệu lịch sử yêu cầu kết nối đến máy chủ backend.
              Tính năng kiểm tra tương tác vẫn hoạt động bình thường.
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
                  placeholder="Tìm phiên theo tên thuốc..."
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
                <RefreshCw size={13} /> Tải lại
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20 text-gray-400 gap-3">
                <RefreshCw size={18} className="animate-spin" /> Đang tải lịch sử...
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-16 h-16 bg-violet-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <BarChart2 size={28} className="text-violet-300" />
                </div>
                <h3 className="font-semibold text-gray-700 mb-1">Chưa có phiên nào</h3>
                <p className="text-gray-400 text-sm mb-5">Kiểm tra tương tác thuốc và nhấn "Lưu phiên" để lưu vào đây.</p>
                <Link to="/interactions"
                  className="inline-flex items-center gap-2 bg-violet-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-violet-700 transition-colors">
                  <Zap size={14} /> Bắt đầu kiểm tra tương tác
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {sessions.map(s => (
                  <SessionCard key={s.id} session={s}
                    onDelete={deleteSession}
                    onEdit={setEditingSession}
                    onExpand={toggleExpand}
                    expanded={expandedId === s.id}
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
                <Shield size={16} className="text-violet-600" /> Phân bố mức độ tương tác
              </h3>
              {(() => {
                const total = stats.total_major + stats.total_moderate + stats.total_minor;
                return total === 0 ? (
                  <p className="text-sm text-gray-400">Chưa có dữ liệu</p>
                ) : (
                  <div className="space-y-4">
                    {[
                      { label: 'Nguy hiểm cao', count: stats.total_major, color: 'bg-red-500', textColor: 'text-red-600', pct: Math.round((stats.total_major/total)*100) },
                      { label: 'Trung bình', count: stats.total_moderate, color: 'bg-amber-400', textColor: 'text-amber-600', pct: Math.round((stats.total_moderate/total)*100) },
                      { label: 'Thấp / Không rõ', count: stats.total_minor, color: 'bg-green-500', textColor: 'text-green-600', pct: Math.round((stats.total_minor/total)*100) },
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
                      Tổng {total.toLocaleString()} cặp tương tác từ {stats.total_sessions} phiên
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Top drugs */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h3 className="font-bold text-gray-800 mb-5 flex items-center gap-2">
                <Star size={16} className="text-amber-500" /> Thuốc kiểm tra nhiều nhất
              </h3>
              {stats.most_checked_drugs.length === 0 ? (
                <p className="text-sm text-gray-400">Chưa có dữ liệu</p>
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
                <TrendingUp size={16} className="text-blue-500" /> Phiên kiểm tra theo tháng
              </h3>
              {stats.sessions_by_month.length === 0 ? (
                <p className="text-sm text-gray-400">Chưa có dữ liệu</p>
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
                  <strong>Về dữ liệu thống kê:</strong> Số liệu được tổng hợp từ tất cả các phiên kiểm tra đã lưu.
                  Dữ liệu tương tác dựa trên DrugBank® v5 — 24,386+ cặp tương tác được phân loại.
                  Chỉ dùng cho mục đích tham khảo học thuật, không thay thế tư vấn lâm sàng chuyên nghiệp.
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
    { label: 'Tên', key: 'name' },
    { label: 'Loại', key: 'type' },
    { label: 'Nhóm', key: 'groups' },
    { label: 'Trạng thái', key: 'state' },
    { label: 'Công thức', key: 'molecular_formula' },
    { label: 'Phân tử lượng', key: 'molecular_weight' },
    { label: 'Chỉ định', key: 'indication' },
    { label: 'Cơ chế', key: 'mechanism' },
    { label: 'Số Protein đích', key: 'targets' },
    { label: 'Số Enzyme', key: 'enzymes' },
    { label: 'Số Transporter', key: 'transporters' },
  ];

  return (
    <div>
      <div className="mb-6">
        <h2 className="font-bold text-gray-800 text-lg mb-1">So sánh thuốc</h2>
        <p className="text-sm text-gray-500">Chọn 2 thuốc để so sánh thông số dược học từ cơ sở dữ liệu.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 mb-6">
        {([0, 1] as const).map(idx => (
          <div key={idx} className="relative">
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              {idx === 0 ? 'Thuốc thứ nhất' : 'Thuốc thứ hai'}
            </label>
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus-within:border-violet-400 shadow-sm transition-colors">
              <Pill size={14} className="text-gray-400 shrink-0" />
              <input value={query[idx]} onChange={e => search(idx, e.target.value)}
                placeholder="Tìm tên thuốc..."
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
            <div className="px-5 py-4 border-r border-white/10 text-xs font-semibold uppercase tracking-wide text-violet-200">Thông số</div>
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
              Xem chi tiết {d1.name} <ArrowRight size={13} />
            </Link>
            <Link to={`/drugs/${d2.id}`}
              className="flex items-center justify-center gap-1.5 text-sm font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 py-2.5 rounded-xl transition-colors">
              Xem chi tiết {d2.name} <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      ) : (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
          <div className="w-14 h-14 bg-violet-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Activity size={24} className="text-violet-300" />
          </div>
          <p className="text-gray-400 text-sm">Chọn 2 thuốc ở trên để xem bảng so sánh</p>
        </div>
      )}
    </div>
  );
}
