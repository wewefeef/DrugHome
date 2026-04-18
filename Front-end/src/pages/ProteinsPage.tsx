import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Search, ChevronRight, ChevronLeft, Loader2,
  ExternalLink, Dna, X,
} from "lucide-react";
import { apiFetchProteins } from "../lib/api";
import type { Protein } from "../lib/proteinCache";

const PAGE_SIZE = 25;

const typeBadge: Record<string, string> = {
  target:      "bg-emerald-100 text-emerald-700 border border-emerald-200",
  enzyme:      "bg-amber-100  text-amber-700  border border-amber-200",
  transporter: "bg-violet-100 text-violet-700 border border-violet-200",
  carrier:     "bg-sky-100    text-sky-700    border border-sky-200",
};

const actionBadge: Record<string, string> = {
  inhibitor:     "bg-red-50    text-red-600    border border-red-200",
  activator:     "bg-green-50  text-green-700  border border-green-200",
  agonist:       "bg-blue-50   text-blue-700   border border-blue-200",
  antagonist:    "bg-orange-50 text-orange-700 border border-orange-200",
  binder:        "bg-gray-100  text-gray-600   border border-gray-200",
  modulator:     "bg-purple-50 text-purple-700 border border-purple-200",
  inducer:       "bg-yellow-50 text-yellow-700 border border-yellow-200",
  substrate:     "bg-teal-50   text-teal-700   border border-teal-200",
  other:         "bg-gray-50   text-gray-500   border border-gray-200",
  unknown:       "bg-gray-50   text-gray-400   border border-gray-200",
};
const actionColor = (a: string) => actionBadge[a] || "bg-gray-50 text-gray-500 border border-gray-200";

function Pagination({ current, total, onChange }: {
  current: number; total: number; onChange: (p: number) => void;
}) {
  const pages: (number | "...")[] = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || Math.abs(i - current) <= 2) pages.push(i);
    else if (pages[pages.length - 1] !== "...") pages.push("...");
  }
  return (
    <div className="flex items-center justify-center gap-1.5 mt-8 mb-2">
      <button onClick={() => onChange(current - 1)} disabled={current === 1}
        className="w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-emerald-50 hover:border-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center shadow-sm">
        <ChevronLeft size={15} />
      </button>
      {pages.map((p, i) =>
        p === "..."
          ? <span key={"e" + i} className="w-9 text-center text-gray-400 text-sm">...</span>
          : <button key={p} onClick={() => onChange(p as number)}
              className={"w-9 h-9 rounded-lg text-sm font-semibold transition-all shadow-sm " + (p === current ? "bg-emerald-700 text-white" : "border border-gray-200 bg-white text-gray-600 hover:bg-emerald-50 hover:border-emerald-300")}>
              {p}
            </button>
      )}
      <button onClick={() => onChange(current + 1)} disabled={current === total}
        className="w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-emerald-50 hover:border-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center shadow-sm">
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

export default function ProteinsPage() {
  const [proteins, setProteins] = useState<Protein[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All types");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    apiFetchProteins({
      q: activeQuery || undefined,
      protein_type: typeFilter !== "All types" ? typeFilter : undefined,
      page,
      per_page: PAGE_SIZE,
    })
      .then(result => {
        setProteins(result.items);
        setTotal(result.total);
        setTotalPages(result.total_pages);
      })
      .catch(() => { setProteins([]); setTotal(0); setTotalPages(0); })
      .finally(() => setLoading(false));
  }, [activeQuery, typeFilter, page]);

  const gotoPage = useCallback((p: number) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }, []);
  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); setActiveQuery(query); setPage(1); };
  const resetFilters = () => { setTypeFilter("All types"); setActiveQuery(""); setQuery(""); setPage(1); };
  const activeFilterCount = [typeFilter !== "All types", !!activeQuery].filter(Boolean).length;
  const maxDrugCount = proteins[0]?.drug_count || 1;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-r from-emerald-900 via-emerald-800 to-teal-800 text-white pt-8 pb-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center gap-2 text-emerald-300 text-sm mb-4">
            <Link to="/" className="hover:text-white transition-colors">Home</Link>
            <ChevronRight size={14} />
            <span className="text-white font-medium">Proteins &amp; Targets</span>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-4 mb-2">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center">
                <Dna size={26} className="text-emerald-300" />
              </div>
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight">Proteins &amp; Targets</h1>
                <p className="text-emerald-300 text-sm mt-0.5">Human proteins involved in pharmacology — targets, enzymes, transporters, carriers</p>
              </div>
            </div>
            {!loading && (
              <div className="bg-white/10 border border-white/20 rounded-full px-4 py-1.5 text-sm font-semibold text-emerald-200">
                {total.toLocaleString()} proteins
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 mt-5 mb-6">
            {[
              { key: "target",      color: "bg-emerald-400/20 border-emerald-400/40 text-emerald-200", dot: "bg-emerald-400" },
              { key: "enzyme",      color: "bg-amber-400/20  border-amber-400/40  text-amber-200",   dot: "bg-amber-400" },
              { key: "transporter", color: "bg-violet-400/20 border-violet-400/40 text-violet-200",  dot: "bg-violet-400" },
              { key: "carrier",     color: "bg-sky-400/20    border-sky-400/40    text-sky-200",     dot: "bg-sky-400" },
            ].map(s => (
              <button key={s.key} onClick={() => { setTypeFilter(typeFilter === s.key ? "All types" : s.key); setPage(1); }}
                className={"border rounded-full px-3 py-1 text-xs font-semibold flex items-center gap-1.5 transition-all " + s.color + (typeFilter === s.key ? " ring-2 ring-white/40" : " hover:ring-1 hover:ring-white/30")}>
                <span className={"w-1.5 h-1.5 rounded-full " + s.dot} />
                {s.key.charAt(0).toUpperCase() + s.key.slice(1)}:
                <span className="font-bold ml-0.5">{s.key}</span>
              </button>
            ))}
          </div>

          <form onSubmit={handleSearch} className="flex gap-2 max-w-3xl flex-wrap">
            <div className="flex-1 min-w-0 flex bg-white rounded-xl overflow-hidden shadow-lg ring-2 ring-white/20 focus-within:ring-emerald-300 transition-all">
              <div className="pl-4 flex items-center text-gray-400"><Search size={16} /></div>
              <input type="text" value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search gene name, UniProt ID, action..."
                className="flex-1 px-3 py-3 text-gray-800 outline-none text-sm" />
              {query && (
                <button type="button" className="px-3 text-gray-400 hover:text-gray-600"
                  onClick={() => { setQuery(""); setActiveQuery(""); setPage(1); }}>
                  <X size={15} />
                </button>
              )}
            </div>
            <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
              className="bg-white text-gray-700 text-sm px-3 py-3 rounded-xl shadow-lg border-0 outline-none min-w-[130px] font-medium">
              <option>All types</option>
              <option>target</option>
              <option>enzyme</option>
              <option>transporter</option>
              <option>carrier</option>
            </select>
            <button type="submit"
              className="bg-emerald-400 hover:bg-emerald-300 text-emerald-900 px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 transition-colors shadow-lg">
              <Search size={15} /> Search
            </button>
            {activeFilterCount > 0 && (
              <button type="button" onClick={resetFilters}
                className="border border-white/30 text-white/80 hover:text-white px-4 py-3 rounded-xl text-sm flex items-center gap-1.5 transition-colors">
                <X size={14} /> Clear
              </button>
            )}
          </form>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4 text-sm text-gray-500">
          {loading
            ? <span className="flex items-center gap-1.5 text-gray-400"><Loader2 size={14} className="animate-spin" /> Loading proteins...</span>
            : <span>
                Showing{" "}
                <span className="font-bold text-emerald-700">
                  {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}
                  {"\u2013"}
                  {Math.min(page * PAGE_SIZE, total)}
                </span>{" "}
                of{" "}
                <span className="font-bold text-emerald-700">{total.toLocaleString()}</span> proteins
                {activeQuery && <span> for &quot;<span className="font-semibold">{activeQuery}</span>&quot;</span>}
              </span>}
        </div>

        {loading ? (
          <div className="text-center py-24">
            <Loader2 size={48} className="text-emerald-300 animate-spin mx-auto mb-4" />
            <p className="text-gray-500 font-medium">Loading protein database...</p>
          </div>
        ) : proteins.length === 0 ? (
          <div className="text-center py-24 bg-white rounded-2xl border border-gray-100">
            <Search size={48} className="text-gray-200 mx-auto mb-4" />
            <h3 className="font-bold text-gray-500 mb-1">No results found</h3>
            <p className="text-gray-400 text-sm">Try a different search or clear the filters</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="grid grid-cols-[2fr_1fr_1fr_2fr_100px] gap-3 px-5 py-3 bg-gray-50 border-b border-gray-100 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
              <div>Protein (Gene)</div>
              <div>UniProt ID</div>
              <div>Type</div>
              <div>Actions / Interactions</div>
              <div className="text-right">Drug Count</div>
            </div>

            {proteins.map((protein, idx) => (
              <div key={protein.id}
                className={"grid grid-cols-[2fr_1fr_1fr_2fr_100px] gap-3 px-5 py-4 items-start transition-colors hover:bg-emerald-50/40 " + (idx < proteins.length - 1 ? "border-b border-gray-50" : "")}>  

                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-sm text-emerald-700 truncate max-w-[180px]" title={protein.name}>
                      {protein.gene_name || protein.name.split(" ")[0]}
                    </span>
                    <a href={"https://www.uniprot.org/uniprotkb?query=" + protein.uniprot_id}
                      target="_blank" rel="noopener noreferrer"
                      className="text-gray-300 hover:text-emerald-500 transition-colors">
                      <ExternalLink size={11} />
                    </a>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 leading-snug line-clamp-2 pr-2" title={protein.name}>{protein.name}</p>
                  <p className="text-[10px] text-gray-400 italic mt-1">{protein.organism}</p>
                </div>

                <div className="pt-0.5">
                  <span className="font-mono text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded border border-gray-200 break-all">
                    {protein.uniprot_id}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1 pt-0.5">
                  {protein.types.map(t => (
                    <span key={t} className={"text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize " + (typeBadge[t] || "bg-gray-100 text-gray-500")}>
                      {t}
                    </span>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1 pt-0.5">
                  {protein.actions.slice(0, 6).map(a => (
                    <span key={a} className={"text-[10px] px-1.5 py-0.5 rounded font-medium " + actionColor(a)}>
                      {a}
                    </span>
                  ))}
                  {protein.actions.length > 6 && (
                    <span className="text-[10px] text-gray-400 self-center">+{protein.actions.length - 6}</span>
                  )}
                  {protein.actions.length === 0 && <span className="text-[10px] text-gray-300 italic">—</span>}
                </div>

                <div className="flex flex-col items-end gap-1.5 pt-0.5">
                  <span className="font-bold text-emerald-700 text-sm">{protein.drug_count.toLocaleString()}</span>
                  <div className="w-14 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full"
                      style={{ width: Math.round((protein.drug_count / maxDrugCount) * 100) + "%" }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && totalPages > 1 && (
          <Pagination current={page} total={totalPages} onChange={gotoPage} />
        )}
        <div className="h-10" />
      </div>
    </div>
  );
}