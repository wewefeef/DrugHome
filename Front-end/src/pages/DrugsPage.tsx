import { useState, useMemo, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Search, ChevronRight, ChevronLeft, SlidersHorizontal, X, LayoutGrid, List,
  Pill, Loader2,
} from "lucide-react";
import type { Drug } from "../types/drug";
import { getDrugs } from "../lib/drugCache";

const PAGE_SIZE = 24;

const statusBadge: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  investigational: "bg-sky-100 text-sky-700 border border-sky-200",
  experimental: "bg-purple-100 text-purple-700 border border-purple-200",
  withdrawn: "bg-red-100 text-red-700 border border-red-200",
  illicit: "bg-gray-100 text-gray-600 border border-gray-200",
};
const typeBadge: Record<string, string> = {
  "Small molecule": "bg-orange-50 text-orange-600 border border-orange-200",
  "small molecule": "bg-orange-50 text-orange-600 border border-orange-200",
  "biotech": "bg-violet-50 text-violet-600 border border-violet-200",
  "Biotech": "bg-violet-50 text-violet-600 border border-violet-200",
};

// ─────────────────────────────────────────────
// Pagination (handles large page counts)
// ─────────────────────────────────────────────
function Pagination({ current, total, onChange }: {
  current: number; total: number; onChange: (p: number) => void;
}) {
  const withEllipsis: (number | "...")[] = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || Math.abs(i - current) <= 2) withEllipsis.push(i);
    else if (withEllipsis[withEllipsis.length - 1] !== "...") withEllipsis.push("...");
  }


  return (
    <div className="flex items-center justify-center gap-1.5 mt-10">
      <button onClick={() => onChange(current - 1)} disabled={current === 1}
        className="w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-primary-50 hover:border-primary-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-all shadow-sm">
        <ChevronLeft size={15} />
      </button>
      {withEllipsis.map((p, i) =>
        p === "..." ? (
          <span key={"el-" + i} className="w-9 h-9 flex items-center justify-center text-gray-400 text-sm">…</span>
        ) : (
          <button key={p} onClick={() => onChange(p as number)}
            className={"w-9 h-9 rounded-lg border text-sm font-medium transition-all shadow-sm " + (current === p
              ? "bg-primary-800 border-primary-800 text-white shadow-md"
              : "border-gray-200 bg-white text-gray-600 hover:bg-primary-50 hover:border-primary-300")}>
            {p}
          </button>
        )
      )}
      <button onClick={() => onChange(current + 1)} disabled={current === total}
        className="w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-primary-50 hover:border-primary-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-all shadow-sm">
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// Drug Card (grid view)
// ─────────────────────────────────────────────
function DrugCard({ drug }: { drug: Drug }) {
  return (
    <Link to={"/drugs/" + drug.id}
      className="bg-white rounded-2xl border border-gray-100 shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 overflow-hidden flex flex-col group">
      {/* ── Header strip ─────────────────────── */}
      <div className="bg-gradient-to-r from-primary-900 to-primary-800 px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
        <span className="font-mono font-bold text-blue-200 text-sm tracking-widest bg-white/10 px-2.5 py-1 rounded-md">
          {drug.id}
        </span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {drug.groups.map(g => (
            <span key={g} className={"text-[10px] font-semibold px-2 py-0.5 rounded-full " + statusBadge[g]}>
              {g === "approved" ? "✓ " : "◎ "}{g}
            </span>
          ))}
          <span className={"text-[10px] font-medium px-2 py-0.5 rounded-full " + (typeBadge[drug.type] || "bg-gray-100 text-gray-500")}>
            {drug.type}
          </span>
        </div>
      </div>

      {/* ── Drug name ────────────────────────── */}
      <div className="px-4 pt-3 pb-2">
        <h3 className="font-extrabold text-gray-900 text-base leading-snug group-hover:text-primary-700 transition-colors">
          {drug.name}
        </h3>
        <p className="text-gray-400 text-xs mt-0.5 italic">{drug.generic_name}</p>
      </div>

      {/* ── Description + Formula ── */}
      <div className="px-4 pt-2 flex-1">
        <p className="text-gray-500 text-xs leading-relaxed line-clamp-3">{drug.description || 'No description available.'}</p>
        {drug.molecular_formula && (
          <div className="mt-2.5 flex items-center gap-1.5">
            <span className="font-mono bg-slate-50 border border-slate-200 text-slate-600 text-[11px] px-2 py-0.5 rounded-md">{drug.molecular_formula}</span>
            {drug.molecular_weight && <span className="text-gray-400 text-[10px]">{Number(drug.molecular_weight).toFixed(2)} g/mol</span>}
          </div>
        )}
      </div>

      {/* ── Footer: Category + stats ─────────── */}
      <div className="px-4 pt-3 pb-4 mt-auto">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <span className="bg-primary-50 text-primary-700 border border-primary-100 text-xs font-semibold px-2.5 py-1 rounded-full truncate max-w-[130px]" title={drug.categories[0]}>
            {drug.categories[0] || '—'}
          </span>
          <div className="flex items-center gap-2 text-[10px] font-medium shrink-0">
            <span className="flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-100">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              {drug.targets}T
            </span>
            <span className="flex items-center gap-1 bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-100">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
              {drug.enzymes}E
            </span>
            {drug.transporters > 0 && (
              <span className="flex items-center gap-1 bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full border border-violet-100">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block" />
                {drug.transporters}Tr
              </span>
            )}
          </div>
        </div>
        <div className="mt-2.5 flex items-center gap-1 text-primary-600 text-xs font-semibold group-hover:gap-2 transition-all">
          View details <ChevronRight size={12} />
        </div>
      </div>
    </Link>
  );
}

// ─────────────────────────────────────────────
// Drug Row (list view)
// ─────────────────────────────────────────────
function DrugRow({ drug }: { drug: Drug }) {
  return (
    <Link to={"/drugs/" + drug.id}
      className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-card hover:border-primary-200 transition-all flex items-center gap-4 px-5 py-4 group">
      <div className="w-32 shrink-0">
        <span className="font-mono font-bold text-primary-700 text-sm tracking-wider">{drug.id}</span>
        <div className="flex flex-wrap gap-1 mt-1">
          {drug.groups.map(g => (
            <span key={g} className={"text-[9px] font-semibold px-1.5 py-0.5 rounded-full " + statusBadge[g]}>{g}</span>
          ))}
        </div>
      </div>
      <div className="w-48 shrink-0">
        <div className="font-bold text-gray-900 text-sm group-hover:text-primary-700 transition-colors">{drug.name}</div>
        <div className="text-gray-400 text-xs italic mt-0.5 truncate">{drug.generic_name}</div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-gray-500 text-xs leading-relaxed line-clamp-2">{drug.description}</p>
      </div>
      <div className="shrink-0 text-right">
        <span className="bg-primary-50 text-primary-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-primary-100 block mb-1.5">
          {drug.categories[0] || '—'}
        </span>
        <div className="flex gap-1 justify-end text-[10px] font-medium">
          <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">{drug.targets}T</span>
          <span className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">{drug.enzymes}E</span>
        </div>
      </div>
    </Link>
  );
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────
export default function DrugsPage() {
  const [searchParams] = useSearchParams();
  const [allDrugs, setAllDrugs] = useState<Drug[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [activeQuery, setActiveQuery] = useState(searchParams.get("q") || "");
  const [category, setCategory] = useState("All");
  const [drugType, setDrugType] = useState("All");
  const [groupFilter, setGroupFilter] = useState("All");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  useEffect(() => {
    setLoading(true);
    getDrugs().then(data => { setAllDrugs(data); setLoading(false); });
  }, []);

  const allCategories = useMemo(() => {
    const s = new Set<string>();
    allDrugs.forEach(d => d.categories.forEach(c => { if (c) s.add(c); }));
    return ["All", ...Array.from(s).sort().slice(0, 40)];
  }, [allDrugs]);

  const allTypes = useMemo(() => {
    const s = new Set<string>();
    allDrugs.forEach(d => { if (d.type) s.add(d.type); });
    return ["All", ...Array.from(s).sort()];
  }, [allDrugs]);

  const filtered = useMemo(() => {
    const q = activeQuery.toLowerCase();
    return allDrugs.filter(d => {
      const matchQ = !q ||
        d.name.toLowerCase().includes(q) ||
        d.generic_name.toLowerCase().includes(q) ||
        d.id.toLowerCase().includes(q) ||
        d.aliases.some(a => a.toLowerCase().includes(q));
      const matchCat = category === "All" || d.categories.includes(category);
      const matchType = drugType === "All" || d.type.toLowerCase() === drugType.toLowerCase();
      const matchGroup = groupFilter === "All" || d.groups.includes(groupFilter);
      return matchQ && matchCat && matchType && matchGroup;
    });
  }, [allDrugs, activeQuery, category, drugType, groupFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const activeFiltersCount = [category, drugType, groupFilter].filter(v => v !== "All").length;

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); setActiveQuery(query); setPage(1); };
  const resetFilters = useCallback(() => { setCategory("All"); setDrugType("All"); setGroupFilter("All"); setPage(1); }, []);
  const gotoPage = useCallback((p: number) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Page header ───────────────────────── */}
      <div className="bg-gradient-to-r from-primary-950 via-primary-900 to-primary-800 text-white pt-8 pb-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center gap-2 text-blue-300 text-sm mb-4">
            <a href="/" className="hover:text-white transition-colors">Home</a>
            <ChevronRight size={14} />
            <span className="text-white">Drug Database</span>
          </div>
          <div className="flex items-center gap-4 mb-2">
            <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center">
              <Pill size={24} className="text-blue-300" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight">Drug Database</h1>
              <p className="text-blue-300 text-sm mt-0.5">Browse {loading ? '...' : allDrugs.length.toLocaleString()}+ drugs from DrugBank®</p>
            </div>
          </div>
          {/* Stats pills */}
          <div className="flex flex-wrap gap-2 mt-4 mb-6">
            {[
              { key: 'approved', color: 'bg-emerald-400/20 border-emerald-400/40 text-emerald-200', label: 'Approved' },
              { key: 'investigational', color: 'bg-sky-400/20 border-sky-400/40 text-sky-200', label: 'Investigational' },
              { key: 'small molecule', color: 'bg-orange-400/20 border-orange-400/40 text-orange-200', label: 'Small molecule' },
              { key: 'biotech', color: 'bg-violet-400/20 border-violet-400/40 text-violet-200', label: 'Biotech' },
            ].map(s => (
              <div key={s.key} className={`border rounded-full px-3 py-1 text-xs font-medium flex items-center gap-1.5 ${s.color}`}>
                <span className="font-bold">
                  {loading ? '...' : (s.key === 'small molecule' || s.key === 'biotech'
                    ? allDrugs.filter(d => d.type?.toLowerCase() === s.key).length.toLocaleString()
                    : allDrugs.filter(d => d.groups.includes(s.key)).length.toLocaleString())}
                </span>
                <span className="opacity-70">{s.label}</span>
              </div>
            ))}
          </div>
          {/* Search bar */}
          <form onSubmit={handleSearch} className="mt-6 flex gap-2 max-w-3xl">
            <div className="flex-1 flex bg-white rounded-xl overflow-hidden shadow-lg ring-2 ring-white/20 focus-within:ring-blue-300 transition-all">
              <div className="pl-4 flex items-center text-gray-400">
                <Search size={16} />
              </div>
              <input type="text" value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search by drug name, substance or DrugBank ID (e.g. DB00945)..."
                className="flex-1 px-3 py-3 text-gray-800 outline-none text-sm" />
              {query && (
                <button type="button" className="px-3 text-gray-400 hover:text-gray-600"
                  onClick={() => { setQuery(""); setActiveQuery(""); setPage(1); }}>
                  <X size={15} />
                </button>
              )}
            </div>
            <button type="submit" className="bg-blue-400 hover:bg-blue-300 text-primary-900 px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 transition-colors shadow-lg">
              <Search size={15} /> Search
            </button>
            <button type="button" onClick={() => setShowFilters(!showFilters)}
              className={"relative border-2 text-white px-4 py-3 rounded-xl transition-colors flex items-center gap-1.5 text-sm " + (showFilters || activeFiltersCount > 0 ? "border-blue-300 bg-blue-300/15" : "border-white/30 hover:border-blue-300")}>
              <SlidersHorizontal size={15} />
              <span className="hidden sm:inline">Filter</span>
              {activeFiltersCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-blue-400 text-primary-900 text-[9px] font-black flex items-center justify-center">
                  {activeFiltersCount}
                </span>
              )}
            </button>
          </form>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 -mt-4">
        {/* ── Filter panel ─────────────────────── */}
        {showFilters && (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-5 mb-5 grid sm:grid-cols-3 gap-5">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Categories</label>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                {allCategories.slice(0, 35).map(c => (
                  <button key={c} onClick={() => { setCategory(c); setPage(1); }}
                    className={"text-xs px-2.5 py-1 rounded-full font-medium transition-all " + (category === c ? "bg-primary-800 text-white shadow" : "bg-gray-100 text-gray-600 hover:bg-primary-100 hover:text-primary-700")}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Drug Type</label>
              <div className="flex flex-wrap gap-1.5">
                {allTypes.slice(0, 8).map(t => (
                  <button key={t} onClick={() => { setDrugType(t); setPage(1); }}
                    className={"text-xs px-2.5 py-1 rounded-full font-medium capitalize transition-all " + (drugType === t ? "bg-primary-800 text-white shadow" : "bg-gray-100 text-gray-600 hover:bg-primary-100 hover:text-primary-700")}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Status</label>
              <div className="flex flex-wrap gap-1.5">
                {['All', 'approved', 'investigational', 'experimental', 'withdrawn', 'illicit'].map(g => (
                  <button key={g} onClick={() => { setGroupFilter(g); setPage(1); }}
                    className={"text-xs px-2.5 py-1 rounded-full font-medium transition-all " + (groupFilter === g ? "bg-primary-800 text-white shadow" : "bg-gray-100 text-gray-600 hover:bg-primary-100 hover:text-primary-700")}>
                    {g}
                  </button>
                ))}
              </div>
              {activeFiltersCount > 0 && (
                <button onClick={resetFilters} className="mt-3 text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                  <X size={11} /> Clear filters
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Toolbar ──────────────────────────── */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5 bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100">
          <div className="text-sm text-gray-600 flex items-center gap-2">
            {loading
              ? <span className="flex items-center gap-1.5 text-gray-400"><Loader2 size={14} className="animate-spin" /> Loading...</span>
              : (<>
                  Showing 
                  <span className="font-bold text-primary-800">{filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)}</span>
                   trong <span className="font-bold text-primary-800">{filtered.length.toLocaleString()}</span> drugs
                  {activeQuery && <span> cho “<span className="font-semibold">{activeQuery}</span>”</span>}
                </>)}
          </div>
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <button onClick={() => setViewMode("grid")}
              className={"p-1.5 rounded-md transition-all " + (viewMode === "grid" ? "bg-white text-primary-700 shadow-sm" : "text-gray-400 hover:text-gray-600")}>
              <LayoutGrid size={16} />
            </button>
            <button onClick={() => setViewMode("list")}
              className={"p-1.5 rounded-md transition-all " + (viewMode === "list" ? "bg-white text-primary-700 shadow-sm" : "text-gray-400 hover:text-gray-600")}>
              <List size={16} />
            </button>
          </div>
        </div>

        {/* ── Results ──────────────────────────── */}
        {loading ? (
          <div className="text-center py-24">
            <Loader2 size={48} className="text-primary-300 animate-spin mx-auto mb-4" />
            <p className="text-gray-500 font-medium">Loading drugs from DrugBank...</p>
          </div>
        ) : paginated.length === 0 ? (
          <div className="text-center py-24 bg-white rounded-2xl border border-gray-100">
            <Search size={48} className="text-gray-200 mx-auto mb-4" />
            <h3 className="font-bold text-gray-500 mb-1">No results found</h3>
            <p className="text-gray-400 text-sm">Try a different search or clear the filters</p>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {paginated.map(drug => <DrugCard key={drug.id} drug={drug} />)}
          </div>
        ) : (
          <div className="space-y-2.5">
            {paginated.map(drug => <DrugRow key={drug.id} drug={drug} />)}
          </div>
        )}

        {/* ── Pagination ───────────────────────── */}
        {!loading && pageCount > 1 && (
          <Pagination current={page} total={pageCount} onChange={gotoPage} />
        )}

        {/* bottom padding */}
        <div className="h-12" />
      </div>
    </div>
  );
}
