import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search, Pill, FlaskConical, Zap, BarChart2,
  ArrowRight, ChevronRight, Shield, Database,
  TrendingUp, BookOpen, CheckCircle2, Star
} from 'lucide-react';
import { apiFetchSiteStats } from '../lib/api';

// ──────────────────────────────────────────────
// Hero Banner
// ──────────────────────────────────────────────
function HeroBanner() {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('drug');
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/${type === 'drug' ? 'drugs' : type === 'protein' ? 'proteins' : 'interactions'}?q=${encodeURIComponent(query)}`);
    }
  };

  const suggestions = ['Aspirin', 'Ibuprofen', 'Metformin', 'Amoxicillin', 'Omeprazole'];

  return (
    <section className="relative bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 overflow-hidden">
      {/* Background decorative circles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-primary-700 opacity-20 blur-3xl" />
        <div className="absolute bottom-0 -left-20 w-80 h-80 rounded-full bg-blue-400 opacity-10 blur-3xl" />
        <div className="absolute top-1/2 right-1/4 w-64 h-64 rounded-full bg-cyan-400 opacity-5 blur-2xl" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 py-16 md:py-24">
        <div className="max-w-3xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-primary-700/60 border border-primary-600 rounded-full px-4 py-1.5 mb-6">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-blue-200 text-sm font-medium">Latest System — DrugBank 2024 Data</span>
          </div>

          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight mb-4">
            Intelligent Pharmaceutical<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-300 to-cyan-300">
              Information System
            </span>
          </h1>
          <p className="text-blue-200 text-lg md:text-xl mb-10 leading-relaxed max-w-2xl mx-auto">
            Search drugs, check interactions, analyze target proteins — all in one clinical decision support platform.
          </p>

          {/* Search Widget */}
          <form onSubmit={handleSearch} className="bg-white rounded-2xl shadow-2xl p-2 flex flex-col sm:flex-row gap-2 mb-6 max-w-2xl mx-auto">
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="bg-gray-50 text-gray-700 text-sm font-medium px-4 py-3 rounded-xl border border-gray-200 outline-none cursor-pointer"
            >
              <option value="drug">💊 Drug</option>
              <option value="protein">🧬 Protein</option>
              <option value="interaction">⚡ Interaction</option>
            </select>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Enter drug name, substance, DrugBank ID..."
              className="flex-1 px-4 py-3 text-gray-800 outline-none text-sm rounded-xl bg-transparent"
            />
            <button
              type="submit"
              className="bg-primary-800 hover:bg-primary-900 text-white px-6 py-3 rounded-xl font-semibold flex items-center gap-2 transition-colors text-sm shadow"
            >
              <Search size={16} />
              Search
            </button>
          </form>

          {/* Quick suggestions */}
          <div className="flex flex-wrap justify-center gap-2">
            <span className="text-blue-300 text-sm">Quick search:</span>
            {suggestions.map(s => (
              <button
                key={s}
                className="bg-primary-700/50 hover:bg-primary-600/60 text-blue-200 hover:text-white border border-primary-600 text-xs px-3 py-1 rounded-full transition-all"
                onClick={() => navigate(`/drugs?q=${s}`)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Wave separator */}
      <div className="absolute bottom-0 left-0 right-0 h-12">
        <svg viewBox="0 0 1440 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" preserveAspectRatio="none">
          <path d="M0 48L1440 48L1440 0C1200 40 960 52 720 40C480 28 240 0 0 20L0 48Z" fill="#f9fafb"/>
        </svg>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────
// Stats Section
// ──────────────────────────────────────────────
function StatsSection() {
  const [drugCount, setDrugCount] = useState('...');
  const [proteinCount, setProteinCount] = useState('...');

  useEffect(() => {
    apiFetchSiteStats()
      .then(({ drug_count, protein_count }) => {
        setDrugCount(drug_count.toLocaleString());
        setProteinCount(protein_count.toLocaleString());
      })
      .catch(() => { setDrugCount('17,590'); setProteinCount('5,309'); });
  }, []);

  const stats = [
    { value: drugCount, label: 'Drugs', sub: 'Approved & experimental', icon: <Pill size={28} />, color: 'text-blue-600', bg: 'bg-blue-50' },
    { value: '1,128,500+', label: 'Drug Interactions', sub: 'Recorded interaction pairs', icon: <Zap size={28} />, color: 'text-amber-600', bg: 'bg-amber-50' },
    { value: proteinCount, label: 'Target Proteins', sub: 'Molecular target proteins', icon: <FlaskConical size={28} />, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { value: '41,908', label: 'Drug-Protein Interactions', sub: 'Pharmacodynamic bindings', icon: <Database size={28} />, color: 'text-purple-600', bg: 'bg-purple-50' },
  ];

  return (
    <section className="py-12 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-primary-900">Live data from the system</h2>
          <p className="text-gray-500 mt-1 text-sm">Continuously updated from DrugBank® and biomedical data sources</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((s) => (
            <div key={s.label} className="card p-6 text-center group cursor-pointer">
              <div className={`w-14 h-14 ${s.bg} ${s.color} rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform`}>
                {s.icon}
              </div>
              <div className={`text-3xl font-extrabold ${s.color} mb-1`}>{s.value}</div>
              <div className="text-gray-800 font-semibold text-sm">{s.label}</div>
              <div className="text-gray-400 text-xs mt-1">{s.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────
// Feature Cards
// ──────────────────────────────────────────────
function FeaturesSection() {
  const features = [
    {
      icon: <Pill size={32} />,
      title: 'Drug Database',
      desc: 'Detailed drug information: mechanism of action, indications, contraindications, pharmacokinetics and clinical data.',
      to: '/drugs',
      color: 'from-blue-600 to-blue-800',
      badge: '17,590 drugs',
      highlights: ['Full FDA data', 'Mechanism of action', 'Pharmacokinetics', 'ATC classification'],
    },
    {
      icon: <Zap size={32} />,
      title: 'Interaction Checker',
      desc: 'Analyze interactions between multiple drugs simultaneously, classify severity levels and provide clinical recommendations.',
      to: '/interactions',
      color: 'from-amber-500 to-orange-600',
      badge: '1,128,500+ interactions',
      highlights: ['Multi-drug checker', 'Risk classification', 'Interaction mechanism', 'Clinical alerts'],
    },
    {
      icon: <FlaskConical size={32} />,
      title: 'Target Proteins',
      desc: 'Explore molecular target protein data, gene information, structures and relationships with therapeutic drugs.',
      to: '/proteins',
      color: 'from-emerald-600 to-teal-700',
      badge: '5,309 proteins',
      highlights: ['UniProt data', '3D structure', 'Gene info', 'Drug binding'],
    },
    {
      icon: <BarChart2 size={32} />,
      title: 'Analysis Tools',
      desc: 'Comprehensive drug profile analysis, interaction report generation and intelligent clinical decision support.',
      to: '/analysis',
      color: 'from-purple-600 to-indigo-700',
      badge: 'AI-Powered',
      highlights: ['Multi-drug analysis', 'PDF reports', 'Risk scoring', 'Smart CDS'],
    },
  ];

  return (
    <section className="py-16 bg-white">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-12">
          <span className="text-primary-700 font-semibold text-sm uppercase tracking-widest">Key Features</span>
          <h2 className="section-title mt-2">All pharmaceutical tools<br />in one platform</h2>
          <p className="text-gray-500 mt-3 max-w-xl mx-auto">Built for students, researchers and healthcare professionals to look up and analyze pharmaceutical information.</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f) => (
            <Link key={f.to} to={f.to} className="card group overflow-hidden flex flex-col">
              {/* Header gradient */}
              <div className={`bg-gradient-to-br ${f.color} p-6 text-white relative overflow-hidden`}>
                <div className="absolute -top-4 -right-4 w-24 h-24 rounded-full bg-white/10" />
                <div className="relative">
                  <div className="mb-3 opacity-90">{f.icon}</div>
                  <span className="bg-white/20 text-white text-xs font-semibold px-2.5 py-1 rounded-full border border-white/30">
                    {f.badge}
                  </span>
                </div>
              </div>

              {/* Content */}
              <div className="p-5 flex flex-col flex-1">
                <h3 className="font-bold text-gray-900 mb-2 text-base group-hover:text-primary-700 transition-colors">{f.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed mb-4 flex-1">{f.desc}</p>
                <ul className="space-y-1.5 mb-4">
                  {f.highlights.map(h => (
                    <li key={h} className="flex items-center gap-2 text-xs text-gray-600">
                      <CheckCircle2 size={12} className="text-green-500 shrink-0" />
                      {h}
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-1 text-primary-700 text-sm font-semibold group-hover:gap-2 transition-all">
                  Explore <ArrowRight size={14} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────
// How It Works
// ──────────────────────────────────────────────
function HowItWorksSection() {
  const steps = [
    { num: '01', title: 'Search for a drug', desc: 'Enter the drug name, substance or DrugBank code in the search box.', icon: <Search size={20} /> },
    { num: '02', title: 'View detailed info', desc: 'See full pharmacology, indications, contraindications and target proteins.', icon: <BookOpen size={20} /> },
    { num: '03', title: 'Check interactions', desc: 'Add multiple drugs to the list to check multi-directional interactions.', icon: <Shield size={20} /> },
    { num: '04', title: 'Analyze & Report', desc: 'Export analysis reports, risk assessments and clinical recommendations.', icon: <TrendingUp size={20} /> },
  ];

  return (
    <section className="py-16 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-12">
          <span className="text-primary-700 font-semibold text-sm uppercase tracking-widest">How it works</span>
          <h2 className="section-title mt-2">Just 4 simple steps</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((step, i) => (
            <div key={step.num} className="relative">
              {i < steps.length - 1 && (
                <div className="hidden lg:block absolute top-8 left-full w-full z-0">
                  <div className="border-t-2 border-dashed border-primary-200 mx-4" />
                </div>
              )}
              <div className="card p-6 relative z-10">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-4xl font-black text-primary-100">{step.num}</span>
                  <div className="w-10 h-10 rounded-xl bg-primary-800 text-white flex items-center justify-center">
                    {step.icon}
                  </div>
                </div>
                <h3 className="font-bold text-gray-900 mb-2">{step.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────
// Recent / Popular Drugs
// ──────────────────────────────────────────────
function PopularDrugs() {
  const drugs = [
    { id: 'DB00945', name: 'Aspirin', generic: 'Acetylsalicylic acid', category: 'NSAID / Antiplatelet', status: 'approved', risk: 'Low' },
    { id: 'DB01050', name: 'Ibuprofen', generic: 'Ibuprofen', category: 'NSAID / Anti-inflammatory', status: 'approved', risk: 'Low' },
    { id: 'DB00331', name: 'Metformin', generic: 'Metformin hydrochloride', category: 'Hypoglycemic', status: 'approved', risk: 'Low' },
    { id: 'DB01077', name: 'Amoxicillin', generic: 'Amoxicillin trihydrate', category: 'β-lactam antibiotic', status: 'approved', risk: 'Medium' },
    { id: 'DB00213', name: 'Omeprazole', generic: 'Omeprazole', category: 'Proton pump inhibitor', status: 'approved', risk: 'Low' },
    { id: 'DB00682', name: 'Warfarin', generic: 'Warfarin sodium', category: 'Anticoagulant', status: 'approved', risk: 'High' },
  ];

  const riskColor: Record<string, string> = {
    Low: 'bg-green-100 text-green-700',
    Medium: 'bg-amber-100 text-amber-700',
    High: 'bg-red-100 text-red-700',
  };

  return (
    <section className="py-16 bg-white">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between mb-8">
          <div>
            <span className="text-primary-700 font-semibold text-sm uppercase tracking-widest">Most Popular</span>
            <h2 className="section-title mt-1">Most frequently searched drugs</h2>
          </div>
          <Link to="/drugs" className="flex items-center gap-1 text-primary-700 hover:text-primary-900 font-medium text-sm transition-colors">
            View all <ChevronRight size={16} />
          </Link>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {drugs.map(drug => (
            <Link key={drug.id} to={`/drugs/${drug.id}`} className="card p-5 group flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary-50 flex items-center justify-center shrink-0 group-hover:bg-primary-100 transition-colors">
                <Pill size={22} className="text-primary-700" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <h4 className="font-bold text-gray-900 group-hover:text-primary-700 transition-colors">{drug.name}</h4>
                  <span className={`badge ${riskColor[drug.risk]} shrink-0`}>{drug.risk}</span>
                </div>
                <p className="text-gray-400 text-xs truncate mb-1">{drug.generic}</p>
                <p className="text-gray-500 text-xs">{drug.category}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="bg-blue-50 text-primary-700 text-[10px] font-mono px-2 py-0.5 rounded">{drug.id}</span>
                  <span className="bg-green-50 text-green-700 text-[10px] px-2 py-0.5 rounded capitalize">✓ {drug.status}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────
// CTA Banner
// ──────────────────────────────────────────────
function CTASection() {
  return (
    <section className="py-16 bg-gradient-to-r from-primary-900 to-primary-800">
      <div className="max-w-4xl mx-auto px-4 text-center">
        <div className="flex justify-center mb-4">
          <Star size={32} className="text-yellow-300" />
        </div>
        <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">
          Ready to explore the pharmaceutical system?
        </h2>
        <p className="text-blue-200 text-lg mb-8 max-w-xl mx-auto">
          Start searching drugs, checking interactions and analyzing pharmacology now — free for academic use.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link to="/drugs" className="bg-white text-primary-800 hover:bg-blue-50 font-bold px-8 py-3.5 rounded-xl transition-colors shadow-lg flex items-center gap-2 justify-center">
            <Search size={18} />
            Search drugs now
          </Link>
          <Link to="/analysis" className="border-2 border-blue-300 text-white hover:bg-primary-700 font-bold px-8 py-3.5 rounded-xl transition-colors flex items-center gap-2 justify-center">
            <Zap size={18} />
            Check interactions
          </Link>
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────
// HomePage
// ──────────────────────────────────────────────
export default function HomePage() {
  return (
    <main>
      <HeroBanner />
      <StatsSection />
      <FeaturesSection />
      <PopularDrugs />
      <HowItWorksSection />
      <CTASection />
    </main>
  );
}
