import { useState, useEffect, useCallback } from "react";
import {
  Search, X, Apple, AlertTriangle, Loader2, UtensilsCrossed,
  Coffee, Leaf, Info, ChevronDown, ChevronUp,
} from "lucide-react";
import { apiFetchDrugs } from "../lib/api";
import type { Drug } from "../types/drug";

/* ─────────── TYPES ─────────── */
interface FoodInteraction {
  id: number;
  interaction: string;
}

interface DrugFoodResult {
  drugbank_id: string;
  drug_name: string;
  food_interactions: FoodInteraction[];
  total: number;
}

/* ─────────── COMPONENT ─────────── */
export default function FoodInteractionsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Drug[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedDrugs, setSelectedDrugs] = useState<{ id: string; name: string }[]>([]);
  const [foodResults, setFoodResults] = useState<DrugFoodResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  // Search drugs
  const handleSearch = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await apiFetchDrugs({ q: q.trim(), per_page: 10 });
      setSearchResults(res.items);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // Add drug
  const addDrug = (drug: Drug) => {
    if (selectedDrugs.find(d => d.id === drug.id)) return;
    setSelectedDrugs(prev => [...prev, { id: drug.id, name: drug.name }]);
    setSearchQuery("");
    setSearchResults([]);
  };

  // Remove drug
  const removeDrug = (id: string) => {
    setSelectedDrugs(prev => prev.filter(d => d.id !== id));
    setFoodResults(prev => prev.filter(r => r.drugbank_id !== id));
  };

  // Fetch food interactions when selectedDrugs changes
  useEffect(() => {
    if (selectedDrugs.length === 0) {
      setFoodResults([]);
      return;
    }

    const fetchFoodInteractions = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/v1/drugs/food-interactions-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ drug_ids: selectedDrugs.map(d => d.id) }),
        });
        if (res.ok) {
          const data = await res.json();
          setFoodResults(data.results ?? []);
          // Auto-expand all cards
          setExpandedCards(new Set((data.results ?? []).map((r: DrugFoodResult) => r.drugbank_id)));
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    };

    fetchFoodInteractions();
  }, [selectedDrugs]);

  const toggleCard = (id: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <UtensilsCrossed size={22} />
            </div>
            <h1 className="text-2xl font-bold">Drug–Food Interaction Checker</h1>
          </div>
          <p className="text-emerald-100 text-sm ml-13">
            Check food and beverage interactions for your medications. Select drugs to view dietary warnings and precautions.
          </p>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar */}
          <div className="w-full lg:w-80 shrink-0">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 sticky top-24">
              <h2 className="font-bold text-gray-800 text-sm mb-3 flex items-center gap-2">
                <Search size={14} className="text-emerald-600" />
                Search & Select Drugs
              </h2>

              {/* Search input */}
              <div className="relative mb-4">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => handleSearch(e.target.value)}
                  placeholder="Type drug name or ID..."
                  className="w-full pl-9 pr-8 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-400 bg-gray-50"
                />
                <Search size={14} className="absolute left-3 top-3 text-gray-400" />
                {searchQuery && (
                  <button
                    onClick={() => { setSearchQuery(""); setSearchResults([]); }}
                    className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Search results dropdown */}
              {searchResults.length > 0 && (
                <div className="mb-4 max-h-48 overflow-y-auto border border-gray-100 rounded-xl bg-white shadow-lg">
                  {searchResults.map(drug => (
                    <button
                      key={drug.id}
                      onClick={() => addDrug(drug)}
                      disabled={!!selectedDrugs.find(d => d.id === drug.id)}
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-emerald-50 border-b border-gray-50 last:border-0 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <div className="font-medium text-gray-800">{drug.name}</div>
                      <div className="text-xs text-gray-500 font-mono">{drug.id}</div>
                    </button>
                  ))}
                </div>
              )}

              {searching && (
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
                  <Loader2 size={12} className="animate-spin" /> Searching...
                </div>
              )}

              {/* Selected drugs */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Selected ({selectedDrugs.length})
                </div>
                {selectedDrugs.length === 0 && (
                  <p className="text-xs text-gray-400 italic">No drugs selected yet</p>
                )}
                {selectedDrugs.map(drug => {
                  const result = foodResults.find(r => r.drugbank_id === drug.id);
                  return (
                    <div
                      key={drug.id}
                      className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl"
                    >
                      <Apple size={12} className="text-emerald-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{drug.name}</div>
                        <div className="text-[10px] text-gray-500 font-mono">{drug.id}</div>
                      </div>
                      {result && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                          result.total > 0
                            ? "bg-amber-100 text-amber-700 border border-amber-300"
                            : "bg-green-100 text-green-700 border border-green-300"
                        }`}>
                          {result.total}
                        </span>
                      )}
                      <button
                        onClick={() => removeDrug(drug.id)}
                        className="text-gray-400 hover:text-red-500 transition-colors shrink-0"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Main area */}
          <div className="flex-1 min-w-0">
            {loading && (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={24} className="animate-spin text-emerald-600" />
                <span className="ml-3 text-gray-600 text-sm">Loading food interactions...</span>
              </div>
            )}

            {!loading && selectedDrugs.length === 0 && (
              <div className="text-center py-20">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-emerald-100 flex items-center justify-center">
                  <UtensilsCrossed size={28} className="text-emerald-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-700 mb-2">No Drugs Selected</h3>
                <p className="text-sm text-gray-500 max-w-md mx-auto">
                  Search and select medications from the sidebar to view their food and beverage interaction warnings.
                </p>
              </div>
            )}

            {!loading && foodResults.length > 0 && (
              <div className="space-y-4">
                {foodResults.map(result => {
                  const isExpanded = expandedCards.has(result.drugbank_id);
                  return (
                    <div
                      key={result.drugbank_id}
                      className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
                    >
                      {/* Card header */}
                      <button
                        onClick={() => toggleCard(result.drugbank_id)}
                        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                      >
                        <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                          <Apple size={16} className="text-emerald-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-gray-800">{result.drug_name}</div>
                          <div className="text-xs text-gray-500 font-mono">{result.drugbank_id}</div>
                        </div>
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${
                          result.total > 0
                            ? "bg-amber-100 text-amber-700 border border-amber-200"
                            : "bg-green-100 text-green-700 border border-green-200"
                        }`}>
                          {result.total > 0
                            ? `${result.total} warning${result.total > 1 ? "s" : ""}`
                            : "No warnings"
                          }
                        </span>
                        {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                      </button>

                      {/* Card body */}
                      {isExpanded && (
                        <div className="px-5 pb-5 border-t border-gray-100">
                          {result.total === 0 ? (
                            <div className="flex items-center gap-3 py-6 justify-center">
                              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                                <Leaf size={14} className="text-green-600" />
                              </div>
                              <p className="text-sm text-gray-600">
                                No food interaction warnings found for this medication.
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-3 pt-4">
                              {result.food_interactions.map(fi => (
                                <div
                                  key={fi.id}
                                  className="flex gap-3 p-3.5 bg-amber-50 border border-amber-200 rounded-xl"
                                >
                                  <div className="shrink-0 mt-0.5">
                                    {fi.interaction.toLowerCase().includes("alcohol") ? (
                                      <Coffee size={16} className="text-amber-600" />
                                    ) : fi.interaction.toLowerCase().includes("grapefruit") || fi.interaction.toLowerCase().includes("fruit") ? (
                                      <Apple size={16} className="text-amber-600" />
                                    ) : (
                                      <AlertTriangle size={16} className="text-amber-600" />
                                    )}
                                  </div>
                                  <p className="text-sm text-gray-700 leading-relaxed">
                                    {fi.interaction}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Info box */}
            {!loading && selectedDrugs.length > 0 && (
              <div className="mt-6 flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                <Info size={16} className="text-blue-600 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700 leading-relaxed">
                  Food interaction data is sourced from DrugBank v5. Always consult your healthcare provider
                  or pharmacist for personalized dietary advice when taking medications.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
