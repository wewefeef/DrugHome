import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen, ChevronRight, Search, FlaskConical, Beaker, Activity,
  Stethoscope, Microscope, Pill, ShieldCheck, AlertTriangle, Brain,
  Heart, Zap, Info, ArrowRight, ChevronDown, ChevronUp, Tag, BarChart2,
  Clock, Star, ExternalLink, Globe, FileText, Layers, Target, Atom,
  TrendingUp, Database, Users, Award,
} from 'lucide-react';
import { apiFetchDrugs, apiFetchSiteStats } from '../lib/api';
import type { Drug } from '../types/drug';

// ── Static content data ────────────────────────────────────────────────────

const PHARMACOLOGY_TOPICS = [
  {
    id: 'pk',
    icon: <Activity size={22} className="text-blue-500" />,
    color: 'from-blue-50 to-indigo-50 border-blue-200',
    accent: 'bg-blue-500',
    title: 'Pharmacokinetics',
    subtitle: 'ADME — Absorption, Distribution, Metabolism, Elimination',
    summary: 'Studies how the body processes drugs over time. Covers the 4 ADME stages and key clinical parameters such as AUC, Cmax, and T½.',
    tags: ['ADME', 'Bioavailability', 'Half-life', 'Clearance', 'Volume of distribution'],
    keyPoints: [
      'Bioavailability (F%) reflects the fraction of drug reaching systemic circulation',
      'Volume of distribution (Vd) indicates the extent of drug distribution into tissues',
      'Clearance (CL) depends on renal and hepatic function',
      'Half-life (t½ = 0.693 × Vd / CL) determines dosing interval',
    ],
    formula: 't½ = 0.693 × Vd / CL',
    color_formula: 'text-blue-700 bg-blue-50',
  },
  {
    id: 'pd',
    icon: <Target size={22} className="text-purple-500" />,
    color: 'from-purple-50 to-violet-50 border-purple-200',
    accent: 'bg-purple-500',
    title: 'Pharmacodynamics',
    subtitle: 'Mechanism of action — Receptor — Signal transduction',
    summary: 'Studies drug effects on the body — molecular mechanisms, receptor binding, signal transduction, and physiological responses.',
    tags: ['Receptor binding', 'Agonist', 'Antagonist', 'EC50', 'Efficacy vs Potency'],
    keyPoints: [
      'Full agonist: activates receptor to maximum effect',
      'Partial agonist: lower maximum efficacy than endogenous agonist',
      'Competitive antagonist: competes for binding site — can be overcome by increasing agonist concentration',
      'EC50 represents the concentration achieving 50% of maximum effect',
    ],
    formula: 'E = Emax × [C]^n / (EC50^n + [C]^n)',
    color_formula: 'text-purple-700 bg-purple-50',
  },
  {
    id: 'cyp',
    icon: <FlaskConical size={22} className="text-amber-500" />,
    color: 'from-amber-50 to-yellow-50 border-amber-200',
    accent: 'bg-amber-500',
    title: 'CYP450 Enzymes & Drug Metabolism',
    subtitle: 'CYP3A4 · CYP2D6 · CYP2C9 · CYP2C19 · CYP1A2',
    summary: 'The hepatic Cytochrome P450 enzyme system metabolizes >75% of marketed drugs. CYP inhibition or induction causes the majority of serious drug interactions.',
    tags: ['CYP3A4', 'CYP2D6', 'Inhhibitor', 'Inducer', 'Substrate', 'Prodrug'],
    keyPoints: [
      'CYP3A4 metabolizes ~50% of all drugs — inhibited by grapefruit juice',
      'CYP2D6 has genetic polymorphisms: Poor/Intermediate/Extensive/Ultra-rapid Metabolizer',
      'Rifampicin is the most potent CYP inducer — reduces efficacy of many drugs',
      'Ketoconazole and clarithromycin are clinically important CYP3A4 inhibitors',
    ],
    formula: 'Vm = Vmax × [S] / (Km + [S])',
    color_formula: 'text-amber-700 bg-amber-50',
  },
  {
    id: 'interaction',
    icon: <Zap size={22} className="text-red-500" />,
    color: 'from-red-50 to-rose-50 border-red-200',
    accent: 'bg-red-500',
    title: 'Drug Interactions',
    subtitle: 'PK interactions · PD interactions · Major vs Moderate vs Minor',
    summary: 'Drug interactions occur when the efficacy/toxicity of a drug is altered by another drug, food, or substance. Classified by mechanism and clinical severity.',
    tags: ['PK interaction', 'PD interaction', 'Synergy', 'Antagonism', 'Warfarin', 'Major'],
    keyPoints: [
      'Pharmacokinetic interactions: altered absorption, distribution, metabolism, or elimination',
      'Pharmacodynamic interactions: additive or antagonistic effects',
      'Warfarin + NSAIDs: increased bleeding risk — monitor INR',
      'ACE inhibitor + Potassium: risk of serious hyperkalemia',
    ],
    formula: 'Risk = Σ(major × 3 + moderate × 1.5 + minor × 0.5)',
    color_formula: 'text-red-700 bg-red-50',
  },
  {
    id: 'therapeutic',
    icon: <Heart size={22} className="text-rose-500" />,
    color: 'from-rose-50 to-pink-50 border-rose-200',
    accent: 'bg-rose-500',
    title: 'Drug Classes by Disease Group',
    subtitle: 'Cardiovascular · CNS · Anti-infective · Oncology · Endocrine',
    summary: 'Classifying drugs by therapeutic application helps understand the relationship between mechanism of action and target disease — the foundation of clinical medicine.',
    tags: ['ATC Code', 'WHO Essential', 'First-line', 'Monotherapy', 'Stepwise'],
    keyPoints: [
      'The ATC (Anatomical Therapeutic Chemical) system classifies drugs into 5 levels',
      'WHO Essential Medicines List 2023: 502 globally essential medicines',
      'Cardiovascular drugs (C): beta-blockers, ACEi, statins — highest revenue group',
      'Antibiotics (J01): classified by spectrum and mechanism of antibacterial action',
    ],
    formula: 'ATC Level 1→5: A → C02 → C02A → C02AA → C02AA01',
    color_formula: 'text-rose-700 bg-rose-50',
  },
  {
    id: 'clinical',
    icon: <Stethoscope size={22} className="text-teal-500" />,
    color: 'from-teal-50 to-emerald-50 border-teal-200',
    accent: 'bg-teal-500',
    title: 'Clinical Trials & EBM',
    subtitle: 'Phase I–IV · RCT · NNT · NNH · Evidence grading',
    summary: 'Evidence-Based Medicine (EBM) uses results from randomized controlled trials to guide treatment decisions. NNT/NNH metrics evaluate real-world efficacy.',
    tags: ['RCT', 'Blinding', 'P-value', 'Confidence Interval', 'NNT', 'GRADE'],
    keyPoints: [
      'Phase I: safety, dose tolerance — 20–100 healthy volunteers',
      'Phase II: preliminary efficacy, side effects — 100–300 patients',
      'Phase III: efficacy, comparison to standard treatment — thousands of patients',
      'NNT = 1/ARR — number of patients needed to treat to prevent 1 adverse event',
    ],
    formula: 'NNT = 1 / (CER − EER)',
    color_formula: 'text-teal-700 bg-teal-50',
  },
];

const GLOSSARY: { term: string; def: string; category: string }[] = [
  { term: 'Bioavailability (F)', def: 'Percentage of administered drug reaching systemic circulation unchanged. IV = 100%; oral usually < 100% due to first-pass effect.', category: 'PK' },
  { term: 'Half-life (t½)', def: 'Time for plasma drug concentration to decrease by 50%. After 4–5 t½ the drug reaches steady-state.', category: 'PK' },
  { term: 'Clearance (CL)', def: 'Volume of plasma cleared of drug per unit time (L/h). Includes hepatic CL and renal CL.', category: 'PK' },
  { term: 'Volume of Distribution (Vd)', def: 'Theoretical volume into which a drug would need to be distributed to produce the observed plasma concentration. High Vd → extensive tissue distribution.', category: 'PK' },
  { term: 'EC50', def: 'Concentration achieving 50% of maximum effect. Lower value → higher drug potency.', category: 'PD' },
  { term: 'Therapeutic Index (TI)', def: 'TI = TD50/ED50. Ratio of toxic dose to effective dose. Low TI (warfarin, digoxin, lithium) requires blood level monitoring.', category: 'PD' },
  { term: 'Prodrug', def: 'Pharmacologically inactive compound that becomes active only after enzymatic conversion in vivo. Example: codeine → morphine (CYP2D6).', category: 'PK' },
  { term: 'First-pass Effect', def: 'Metabolism of a drug by the liver or gut wall before reaching systemic circulation, reducing oral bioavailability.', category: 'PK' },
  { term: 'Competitive Antagonist', def: 'Binds to the same site as the agonist but does not activate the receptor. Can be overcome by increasing agonist concentration.', category: 'PD' },
  { term: 'Non-competitive Antagonist', def: 'Binds allosterically or covalently to the receptor. Reduces Emax; cannot be overcome by increasing agonist concentration.', category: 'PD' },
  { term: 'Receptor Downregulation', def: 'Reduction in receptor number due to prolonged agonist exposure. Explains tachyphylaxis and drug tolerance.', category: 'PD' },
  { term: 'CYP Inhibition', def: 'CYP450 enzyme inhibition reduces substrate metabolism → increased drug concentration → potential increased effect/toxicity.', category: 'Interaction' },
  { term: 'P-glycoprotein (P-gp)', def: 'Efflux transporter protein in the gut, BBB, and kidneys. Limits absorption and distribution of many drugs. Substrates: digoxin, dabigatran. Inhibitor: amiodarone.', category: 'PK' },
  { term: 'Protein Binding', def: 'Fraction of drug bound to albumin and plasma proteins. Only the free form is pharmacologically active. Warfarin is 99% protein-bound — interactions can dangerously increase free fraction.', category: 'PK' },
  { term: 'NNT (Number Needed to Treat)', def: 'Number of patients needing treatment to prevent 1 adverse event compared to control. Low NNT = high treatment efficacy.', category: 'EBM' },
  { term: 'Blood-Brain Barrier (BBB)', def: 'Selective barrier formed by brain capillary endothelial cells. Only small, non-polar, lipophilic molecules can cross.', category: 'PK' },
];

const ATC_GROUPS = [
  { code: 'A', label: 'Alimentary tract & Metabolism', color: 'bg-green-100 text-green-800 border-green-200', examples: ['Metformin', 'Omeprazole', 'Simvastatin'] },
  { code: 'B', label: 'Blood & Blood-forming organs', color: 'bg-red-100 text-red-800 border-red-200', examples: ['Warfarin', 'Aspirin', 'Heparin'] },
  { code: 'C', label: 'Cardiovascular', color: 'bg-pink-100 text-pink-800 border-pink-200', examples: ['Atorvastatin', 'Amlodipine', 'Lisinopril'] },
  { code: 'D', label: 'Dermatologicals', color: 'bg-orange-100 text-orange-800 border-orange-200', examples: ['Hydrocortisone', 'Tretinoin', 'Clotrimazole'] },
  { code: 'G', label: 'Genitourinary & Sex hormones', color: 'bg-purple-100 text-purple-800 border-purple-200', examples: ['Sildenafil', 'Testosterone', 'Estradiol'] },
  { code: 'H', label: 'Systemic hormones', color: 'bg-yellow-100 text-yellow-800 border-yellow-200', examples: ['Levothyroxine', 'Prednisone', 'Insulin'] },
  { code: 'J', label: 'Antiinfectives — systemic', color: 'bg-blue-100 text-blue-800 border-blue-200', examples: ['Amoxicillin', 'Ciprofloxacin', 'Azithromycin'] },
  { code: 'L', label: 'Antineoplastics & Immunomodulators', color: 'bg-indigo-100 text-indigo-800 border-indigo-200', examples: ['Methotrexate', 'Cyclophosphamide', 'Imatinib'] },
  { code: 'M', label: 'Musculoskeletal', color: 'bg-teal-100 text-teal-800 border-teal-200', examples: ['Ibuprofen', 'Diclofenac', 'Allopurinol'] },
  { code: 'N', label: 'Nervous system', color: 'bg-violet-100 text-violet-800 border-violet-200', examples: ['Diazepam', 'Sertraline', 'Levodopa'] },
  { code: 'R', label: 'Respiratory', color: 'bg-sky-100 text-sky-800 border-sky-200', examples: ['Salbutamol', 'Fluticasone', 'Montelukast'] },
  { code: 'S', label: 'Sensory organs (Eyes/Ears)', color: 'bg-lime-100 text-lime-800 border-lime-200', examples: ['Timolol', 'Ciprofloxacin ophthalmic', 'Betamethasone'] },
];

const RESEARCH_ARTICLES = [
  {
    id: 1,
    badge: 'Pharmacokinetics',
    badgeColor: 'bg-blue-100 text-blue-700',
    title: 'Impact of CYP2D6 Polymorphisms on Clopidogrel Dosing in Cardiovascular Patients',
    authors: 'Mega JL, Close SL, Wiviott SD et al.',
    journal: 'NEJM', year: 2009, impact: '91.2',
    summary: 'The study found that patients carrying loss-of-function CYP2D6 alleles had significantly reduced antiplatelet efficacy of clopidogrel, increasing cardiovascular event risk.',
    tags: ['CYP2D6', 'Clopidogrel', 'Pharmacogenomics'],
    icon: <FlaskConical size={16} />,
    color: 'border-l-blue-500',
  },
  {
    id: 2,
    badge: 'Drug Interactions',
    badgeColor: 'bg-red-100 text-red-700',
    title: 'Warfarin-NSAID Interactions and GI Bleeding Risk: Meta-analysis',
    authors: 'Herings RM, Stricker BH, de Boer A et al.',
    journal: 'Lancet', year: 1995, impact: '168.9',
    summary: 'Meta-analysis of 12 studies showed concurrent NSAID use with warfarin increased GI bleeding hospitalization risk 15-fold compared to controls.',
    tags: ['Warfarin', 'NSAIDs', 'Drug Interaction', 'GI Bleeding'],
    icon: <AlertTriangle size={16} />,
    color: 'border-l-red-500',
  },
  {
    id: 3,
    badge: 'Clinical Trial',
    badgeColor: 'bg-teal-100 text-teal-700',
    title: 'The JUPITER Trial: Rosuvastatin in Cardiovascular Prevention in High-CRP Patients',
    authors: 'Ridker PM, Danielson E, Fonseca FA et al.',
    journal: 'NEJM', year: 2008, impact: '91.2',
    summary: 'RCT in 17,802 patients. Rosuvastatin 20mg reduced major cardiovascular events by 44% and all-cause mortality by 20% — trial stopped early due to clear benefit.',
    tags: ['Statin', 'CVD Prevention', 'RCT', 'NNT=25'],
    icon: <Heart size={16} />,
    color: 'border-l-teal-500',
  },
  {
    id: 4,
    badge: 'Pharmacodynamics',
    badgeColor: 'bg-purple-100 text-purple-700',
    title: 'Non-competitive Inhibition Mechanism of Omeprazole at Gastric H+/K+-ATPase',
    authors: 'Wallmark B, Jarandi H, Kaul B.',
    journal: 'J Biological Chemistry', year: 1984, impact: '5.0',
    summary: 'Basic research establishing the irreversible inhibition mechanism of omeprazole — covalent bond with Cys813/Cys892 of H+/K+-ATPase, explaining prolonged efficacy in ulcer treatment.',
    tags: ['PPI', 'Omeprazole', 'Proton pump', 'Covalent inhibition'],
    icon: <Beaker size={16} />,
    color: 'border-l-purple-500',
  },
  {
    id: 5,
    badge: 'Pharmacogenomics',
    badgeColor: 'bg-amber-100 text-amber-700',
    title: 'Pharmacogenomics of HLA-B*57:01 and Abacavir Hypersensitivity',
    authors: 'Mallal S, Nolan D, Witt C et al.',
    journal: 'Lancet', year: 2002, impact: '168.9',
    summary: 'Discovered the strong association between HLA-B*57:01 allele and abacavir hypersensitivity syndrome (HIV ARV). Pre-treatment genetic screening completely prevents severe reactions.',
    tags: ['Pharmacogenomics', 'HIV', 'Abacavir', 'HLA typing'],
    icon: <Brain size={16} />,
    color: 'border-l-amber-500',
  },
  {
    id: 6,
    badge: 'Oncology',
    badgeColor: 'bg-indigo-100 text-indigo-700',
    title: 'Imatinib Inhibits BCR-ABL Tyrosine Kinase in Chronic Myeloid Leukemia',
    authors: 'Druker BJ, Talpaz M, Resta DJ et al.',
    journal: 'NEJM', year: 2001, impact: '91.2',
    summary: 'Landmark phase II clinical trial. Imatinib achieved 53% complete hematologic response in CML blast crisis — launching the era of targeted therapy in oncology.',
    tags: ['Imatinib', 'CML', 'BCR-ABL', 'Targeted therapy'],
    icon: <Microscope size={16} />,
    color: 'border-l-indigo-500',
  },
];

const DRUG_FACTS_BASE = [
  { icon: <Database size={20} />, valueKey: 'drug_count' as const, label: 'Drugs in database', color: 'text-blue-600', fallback: '17,430' },
  { icon: <Zap size={20} />, valueKey: null, label: 'Classified interaction pairs', color: 'text-red-600', fallback: '1,128,500+' },
  { icon: <Target size={20} />, valueKey: 'protein_count' as const, label: 'Target proteins', color: 'text-purple-600', fallback: '5,206' },
  { icon: <Globe size={20} />, valueKey: null, label: 'Approving countries', color: 'text-teal-600', fallback: '100+' },
];

// ── Main Component ─────────────────────────────────────────────────────────

export default function ResourcesPage() {
  const [activeSection, setActiveSection] = useState<'topics' | 'glossary' | 'atc' | 'articles' | 'classes'>('topics');
  const [expandedTopic, setExpandedTopic] = useState<string | null>(null);
  const [glossarySearch, setGlossarySearch] = useState('');
  const [glossaryCategory, setGlossaryCategory] = useState('All');
  const [drugClassData, setDrugClassData] = useState<{[group: string]: Drug[]}>({});
  const [loadingDrugs, setLoadingDrugs] = useState(false);
  const [featuredDrugs, setFeaturedDrugs] = useState<Drug[]>([]);
  const [liveStats, setLiveStats] = useState<{drug_count: number; protein_count: number} | null>(null);

  // Fetch live stats for DRUG_FACTS banner
  useEffect(() => {
    apiFetchSiteStats().then(stats => setLiveStats(stats)).catch(() => {});
  }, []);

  // Load drug classes with targeted API calls (no full cache load)
  useEffect(() => {
    setLoadingDrugs(true);
    Promise.all([
      apiFetchDrugs({ group: 'approved', per_page: 12 }),
      apiFetchDrugs({ drug_type: 'small molecule', per_page: 20 }),
      apiFetchDrugs({ drug_type: 'biotech', per_page: 20 }),
      apiFetchDrugs({ group: 'approved', per_page: 20 }),
      apiFetchDrugs({ group: 'investigational', per_page: 20 }),
      apiFetchDrugs({ group: 'experimental', per_page: 20 }),
    ]).then(([featuredRes, smallMolRes, biotechRes, approvedRes, investigationalRes, experimentalRes]) => {
      setFeaturedDrugs(featuredRes.items);
      setDrugClassData({
        'Small molecule': smallMolRes.items,
        'Biotech': biotechRes.items,
        'Approved': approvedRes.items,
        'Investigational': investigationalRes.items,
        'Experimental': experimentalRes.items,
      });
      setLoadingDrugs(false);
    }).catch(() => setLoadingDrugs(false));
  }, []);

  const filteredGlossary = useMemo(() => {
    return GLOSSARY.filter(g => {
      const matchCat = glossaryCategory === 'All' || g.category === glossaryCategory;
      const matchSearch = !glossarySearch ||
        g.term.toLowerCase().includes(glossarySearch.toLowerCase()) ||
        g.def.toLowerCase().includes(glossarySearch.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [glossarySearch, glossaryCategory]);

  const glossaryCategories = ['All', ...Array.from(new Set(GLOSSARY.map(g => g.category)))];

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Hero ── */}
      <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-purple-950 text-white overflow-hidden relative">
        {/* Decorative circles */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/10 rounded-full translate-y-1/2 -translate-x-1/4 pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 py-14 relative">
          <nav className="flex items-center gap-2 text-sm text-slate-400 mb-6">
            <Link to="/" className="hover:text-white transition-colors">Home</Link>
            <ChevronRight size={14} />
            <span className="text-white font-medium">Scientific Resources</span>
          </nav>

          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-xs font-semibold px-3 py-1.5 rounded-full mb-5">
                <Microscope size={13} /> DrugBank® v5 · 2026 Edition
              </div>
              <h1 className="text-4xl lg:text-5xl font-extrabold leading-tight mb-4">
                Pharmacology<br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 to-violet-300">Library</span>
              </h1>
              <p className="text-slate-300 text-base leading-relaxed mb-8 max-w-lg">
                A comprehensive knowledge base covering pharmacokinetics, pharmacodynamics, drug interactions, and clinical evidence — from basic to advanced.
                Data sourced from DrugBank, WHO, and landmark studies.
              </p>
              <div className="flex flex-wrap gap-3">
                {(['topics', 'glossary', 'articles', 'atc', 'classes'] as const).map(s => ({
                  topics: { label: 'Pharmacology Topics', icon: <BookOpen size={14} /> },
                  glossary: { label: 'Glossary', icon: <FileText size={14} /> },
                  articles: { label: 'Featured Research', icon: <Microscope size={14} /> },
                  atc: { label: 'ATC Classification', icon: <Layers size={14} /> },
                  classes: { label: 'Drug Groups', icon: <Pill size={14} /> },
                }[s])).map((item, idx) => {
                  const keys = ['topics', 'glossary', 'articles', 'atc', 'classes'] as const;
                  return (
                    <button key={keys[idx]} onClick={() => setActiveSection(keys[idx])}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                        activeSection === keys[idx]
                          ? 'bg-white text-indigo-900 shadow-lg'
                          : 'bg-white/10 text-white hover:bg-white/20 border border-white/10'
                      }`}>
                      {item.icon} {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Stats panel */}
            <div className="grid grid-cols-2 gap-3">
              {DRUG_FACTS_BASE.map(f => {
                const val = f.valueKey && liveStats
                  ? liveStats[f.valueKey].toLocaleString()
                  : f.fallback;
                return (
                  <div key={f.label} className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-5">
                    <div className={`${f.color} mb-2`}>{f.icon}</div>
                    <div className="text-2xl font-bold text-white">{val}</div>
                    <div className="text-slate-400 text-xs mt-0.5">{f.label}</div>
                  </div>
                );
              })}
              {/* Featured drug mini-card */}
              {featuredDrugs[0] && (
                <div className="col-span-2 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-400/20 rounded-2xl p-4 flex items-center gap-3">
                  <div className="p-2.5 bg-indigo-500/30 rounded-xl">
                    <Pill size={18} className="text-indigo-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-indigo-300 font-medium">Featured Drugs</p>
                    <p className="font-bold text-white text-sm truncate">{featuredDrugs[0].name}</p>
                    <p className="text-slate-400 text-xs truncate">{featuredDrugs[0].mechanism?.slice(0, 80)}...</p>
                  </div>
                  <Link to={`/drugs/${featuredDrugs[0].id}`} className="shrink-0 text-indigo-300 hover:text-white">
                    <ArrowRight size={16} />
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tab Navigation ── */}
      <div className="bg-white border-b border-gray-200 sticky top-[104px] z-30">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex overflow-x-auto gap-0.5 scrollbar-hide">
            {([
              { id: 'topics', label: 'Pharmacology Topics', icon: <BookOpen size={14} /> },
              { id: 'glossary', label: 'Pharmacology Glossary', icon: <FileText size={14} /> },
              { id: 'articles', label: 'Featured Research', icon: <Microscope size={14} /> },
              { id: 'atc', label: 'ATC/WHO Classification', icon: <Layers size={14} /> },
              { id: 'classes', label: 'Drug Groups', icon: <Pill size={14} /> },
            ] as const).map(tab => (
              <button key={tab.id} onClick={() => setActiveSection(tab.id)}
                className={`flex items-center gap-1.5 px-5 py-3.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  activeSection === tab.id
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-200'
                }`}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-10">

        {/* ════════════════ SECTION: TOPICS ════════════════ */}
        {activeSection === 'topics' && (
          <div>
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Core Pharmacology Topics</h2>
              <p className="text-gray-500 text-sm">From basics to advanced — essential knowledge for every clinician</p>
            </div>
            <div className="space-y-4">
              {PHARMACOLOGY_TOPICS.map(topic => (
                <div key={topic.id}
                  className={`bg-gradient-to-r ${topic.color} border rounded-2xl overflow-hidden transition-all`}>
                  <button
                    className="w-full text-left p-6 flex items-start justify-between gap-4"
                    onClick={() => setExpandedTopic(expandedTopic === topic.id ? null : topic.id)}>
                    <div className="flex items-start gap-4">
                      <div className="p-3 bg-white/70 rounded-xl shadow-sm shrink-0">
                        {topic.icon}
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900 text-base mb-0.5">{topic.title}</h3>
                        <p className="text-xs font-medium text-gray-500 mb-2">{topic.subtitle}</p>
                        <p className="text-sm text-gray-700 leading-relaxed">{topic.summary}</p>
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {topic.tags.map(t => (
                            <span key={t} className="text-[11px] bg-white/70 text-gray-600 border border-gray-200 px-2 py-0.5 rounded-full">{t}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 text-gray-400">
                      {expandedTopic === topic.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </div>
                  </button>

                  {expandedTopic === topic.id && (
                    <div className="px-6 pb-6 border-t border-gray-200/50">
                      <div className="grid md:grid-cols-2 gap-6 mt-5">
                        <div>
                          <h4 className="font-semibold text-gray-800 text-sm mb-3 flex items-center gap-2">
                            <ShieldCheck size={14} className="text-gray-500" /> Key clinical points
                          </h4>
                          <ul className="space-y-2.5">
                            {topic.keyPoints.map((kp, i) => (
                              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                                <span className={`w-5 h-5 rounded-full ${topic.accent} text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5`}>
                                  {i + 1}
                                </span>
                                {kp}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-800 text-sm mb-3 flex items-center gap-2">
                            <Atom size={14} className="text-gray-500" /> Basic formula
                          </h4>
                          <div className={`rounded-xl p-4 font-mono text-sm font-bold border ${topic.color_formula}`}>
                            {topic.formula}
                          </div>
                          <div className="mt-4 bg-white/60 rounded-xl p-4 border border-gray-200/50">
                            <p className="text-xs text-gray-500 leading-relaxed">
                              <strong className="text-gray-700">Quick links:</strong>{' '}
                              {topic.id === 'pk' && <><Link to="/drugs" className="text-indigo-600 hover:underline">Browse Drugs → PK data</Link> · <Link to="/interactions" className="text-indigo-600 hover:underline">Check Interactions</Link></>}
                              {topic.id === 'cyp' && <><Link to="/interactions" className="text-indigo-600 hover:underline">View CYP interaction pairs</Link> · <Link to="/proteins" className="text-indigo-600 hover:underline">CYP Proteins</Link></>}
                              {topic.id === 'interaction' && <><Link to="/interactions" className="text-indigo-600 hover:underline">Drug Interaction Checker</Link> · <Link to="/analysis" className="text-indigo-600 hover:underline">Check History</Link></>}
                              {(topic.id === 'pd' || topic.id === 'therapeutic' || topic.id === 'clinical') && <><Link to="/drugs" className="text-indigo-600 hover:underline">Browse drug list</Link> · <Link to="/proteins" className="text-indigo-600 hover:underline">Target Proteins</Link></>}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════════════════ SECTION: GLOSSARY ════════════════ */}
        {activeSection === 'glossary' && (
          <div>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Pharmacology Glossary</h2>
              <p className="text-gray-500 text-sm">Standard definitions of pharmacological concepts — a quick clinical reference dictionary</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <div className="flex-1 flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 shadow-sm focus-within:border-indigo-400 transition-colors">
                <Search size={15} className="text-gray-400 shrink-0" />
                <input value={glossarySearch} onChange={e => setGlossarySearch(e.target.value)}
                  placeholder="Search glossary..." className="flex-1 text-sm outline-none placeholder-gray-400" />
              </div>
              <div className="flex gap-2 flex-wrap">
                {glossaryCategories.map(c => (
                  <button key={c} onClick={() => setGlossaryCategory(c)}
                    className={`text-xs px-3 py-1.5 rounded-xl border font-medium transition-colors ${
                      glossaryCategory === c ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                    }`}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              {filteredGlossary.map(item => (
                <div key={item.term} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="font-bold text-gray-900 text-sm">{item.term}</h3>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                      item.category === 'PK' ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : item.category === 'PD' ? 'bg-purple-50 text-purple-700 border-purple-200'
                        : item.category === 'Interaction' ? 'bg-red-50 text-red-700 border-red-200'
                        : 'bg-green-50 text-green-700 border-green-200'
                    }`}>
                      {item.category}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">{item.def}</p>
                </div>
              ))}
              {filteredGlossary.length === 0 && (
                <div className="col-span-2 text-center py-12 text-gray-400">
                  <FileText size={32} className="mx-auto mb-3 opacity-30" />
                  <p>No matching terms found</p>
                </div>
              )}
            </div>

            <div className="mt-6 bg-indigo-50 border border-indigo-200 rounded-2xl p-5 flex items-start gap-3">
              <Info size={16} className="text-indigo-500 mt-0.5 shrink-0" />
              <p className="text-sm text-indigo-700">
                <strong>References:</strong> Goodman & Gilman's Pharmacology 14th Ed · Katzung Basic & Clinical Pharmacology 15th Ed · WHO Model Formulary · FDA Prescribing Information databases
              </p>
            </div>
          </div>
        )}

        {/* ════════════════ SECTION: RESEARCH ARTICLES ════════════════ */}
        {activeSection === 'articles' && (
          <div>
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Featured Clinical Studies</h2>
              <p className="text-gray-500 text-sm">Landmark studies that changed clinical pharmacy and cardiology practice</p>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              {RESEARCH_ARTICLES.map(art => (
                <div key={art.id}
                  className={`bg-white rounded-2xl border border-gray-100 shadow-sm border-l-4 ${art.color} p-6 flex flex-col hover:shadow-md transition-shadow`}>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border ${art.badgeColor} border-current/20`}>
                      {art.icon} {art.badge}
                    </span>
                    <div className="text-right shrink-0">
                      <span className="text-xs font-bold text-gray-400">{art.journal}</span>
                      <span className="text-xs text-gray-300 mx-1">·</span>
                      <span className="text-xs text-gray-400">{art.year}</span>
                    </div>
                  </div>

                  <h3 className="font-bold text-gray-900 text-sm leading-snug mb-2">{art.title}</h3>
                  <p className="text-xs text-gray-400 italic mb-3">{art.authors}</p>
                  <p className="text-sm text-gray-600 leading-relaxed flex-1">{art.summary}</p>

                  <div className="flex flex-wrap gap-1.5 mt-4">
                    {art.tags.map(t => (
                      <span key={t} className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{t}</span>
                    ))}
                  </div>

                  <div className="mt-4 pt-4 border-t border-gray-50 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs text-amber-500">
                      <Star size={11} className="fill-amber-400" />
                      <span className="font-semibold">IF {art.impact}</span>
                    </div>
                    <Link to="/interactions"
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1">
                      Check related drugs <ArrowRight size={11} />
                    </Link>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 grid sm:grid-cols-3 gap-4">
              {[
                { icon: <Award size={20} />, label: 'Nobel Medicine Awards', value: '14 drug studies', color: 'text-amber-500' },
                { icon: <Users size={20} />, label: 'Patients in trials', value: '> 500,000', color: 'text-teal-500' },
                { icon: <TrendingUp size={20} />, label: 'FDA drug approval rate', value: '~12% phase I', color: 'text-indigo-500' },
              ].map(stat => (
                <div key={stat.label} className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4">
                  <div className={stat.color}>{stat.icon}</div>
                  <div>
                    <div className="font-bold text-gray-900">{stat.value}</div>
                    <div className="text-xs text-gray-500">{stat.label}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════════════════ SECTION: ATC ════════════════ */}
        {activeSection === 'atc' && (
          <div>
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">ATC / WHO Classification System</h2>
              <p className="text-gray-500 text-sm max-w-2xl">
                Anatomical Therapeutic Chemical (ATC) — an international classification system developed by WHO. The 5-level ATC code identifies drugs by target organ, therapeutic indication, and chemical composition.
              </p>
            </div>

            {/* ATC structure explanation */}
            <div className="bg-gradient-to-r from-indigo-900 to-purple-900 rounded-2xl p-6 mb-8 text-white">
              <h3 className="font-bold mb-4 text-sm uppercase tracking-wide text-indigo-300">5-Level ATC Code Structure</h3>
              <div className="flex items-center gap-2 flex-wrap">
                {[
                  { level: '1', code: 'C', label: 'Anatomical', color: 'bg-blue-500' },
                  { level: '2', code: 'C10', label: 'Therapeutic group', color: 'bg-indigo-500' },
                  { level: '3', code: 'C10A', label: 'Pharmacological subgroup', color: 'bg-violet-500' },
                  { level: '4', code: 'C10AA', label: 'Chemical subgroup', color: 'bg-purple-500' },
                  { level: '5', code: 'C10AA01', label: 'Active substance (Simvastatin)', color: 'bg-fuchsia-500' },
                ].map((step, i) => (
                  <div key={step.level} className="flex items-center gap-2">
                    {i > 0 && <ChevronRight size={14} className="text-white/40 shrink-0" />}
                    <div className={`${step.color} rounded-xl px-4 py-2.5 text-center min-w-[100px]`}>
                      <div className="text-[10px] font-medium text-white/70 mb-0.5">Level {step.level}</div>
                      <div className="font-bold text-sm">{step.code}</div>
                      <div className="text-[10px] text-white/80 mt-0.5">{step.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ATC groups grid */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {ATC_GROUPS.map(group => (
                <div key={group.code} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-3 mb-3">
                    <span className={`text-lg font-black border rounded-xl w-11 h-11 flex items-center justify-center ${group.color}`}>
                      {group.code}
                    </span>
                    <p className="font-semibold text-gray-800 text-sm leading-tight">{group.label}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.examples.map(ex => (
                      <Link key={ex} to={`/drugs?q=${encodeURIComponent(ex)}`}
                        className="text-[11px] bg-gray-50 hover:bg-indigo-50 text-gray-600 hover:text-indigo-700 border border-gray-200 hover:border-indigo-200 px-2.5 py-1 rounded-full transition-colors">
                        {ex}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
              <Info size={15} className="mt-0.5 shrink-0" />
              <span>WHO updates the ATC catalogue annually. Current version: <strong>WHO ATC 2024</strong>. DDD (Defined Daily Dose) definitions are included to assess national drug consumption.</span>
            </div>
          </div>
        )}

        {/* ════════════════ SECTION: DRUG CLASSES ════════════════ */}
        {activeSection === 'classes' && (
          <div>
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Drug Groups from Database</h2>
              <p className="text-gray-500 text-sm">Real data from DrugBank — classified by molecule type and approval status</p>
            </div>

            {loadingDrugs ? (
              <div className="flex items-center justify-center py-20 text-gray-400 gap-3">
                <Activity size={18} className="animate-spin" /> Loading drug data...
              </div>
            ) : (
              <div className="space-y-10">

                {/* Featured drugs grid */}
                <section>
                  <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <Star size={16} className="text-amber-500 fill-amber-400" />
                    Featured approved drugs — with complete mechanism of action
                  </h3>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {featuredDrugs.map(drug => (
                      <Link key={drug.id} to={`/drugs/${drug.id}`}
                        className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:shadow-md hover:border-indigo-200 transition-all group">
                        <div className="flex items-start justify-between mb-2">
                          <div className="p-2 bg-indigo-50 rounded-xl group-hover:bg-indigo-100 transition-colors">
                            <Pill size={14} className="text-indigo-600" />
                          </div>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            drug.type === 'small molecule'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-purple-50 text-purple-700 border-purple-200'
                          }`}>
                            {drug.type === 'small molecule' ? 'Small Mol.' : 'Biotech'}
                          </span>
                        </div>
                        <h4 className="font-bold text-gray-900 text-sm mb-0.5 truncate">{drug.name}</h4>
                        <p className="text-xs text-gray-500 mb-2 truncate">{drug.id}</p>
                        {drug.mechanism && (
                          <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">{drug.mechanism.slice(0, 90)}...</p>
                        )}
                        <div className="mt-3 flex items-center gap-2 text-indigo-600">
                          <span className="text-[11px] font-medium">View details</span>
                          <ArrowRight size={10} />
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>

                {/* Drug class tables */}
                {Object.entries(drugClassData).map(([groupName, drugs]) => drugs.length > 0 && (
                  <section key={groupName}>
                    <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                      <Tag size={15} className="text-gray-500" />
                      Group: <span className="text-indigo-700">{groupName}</span>
                      <span className="text-xs text-gray-400 font-normal">({drugs.length} samples)</span>
                    </h3>
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                      <div className="grid grid-cols-4 bg-gray-50 border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-wide">
                        <div className="px-5 py-3">Drug Name</div>
                        <div className="px-5 py-3">DrugBank ID</div>
                        <div className="px-5 py-3 hidden md:block">Molecule Type</div>
                        <div className="px-5 py-3 hidden lg:block">Target Proteins</div>
                      </div>
                      {drugs.slice(0, 8).map((drug, i) => (
                        <div key={drug.id}
                          className={`grid grid-cols-4 border-b border-gray-50 hover:bg-indigo-50/30 transition-colors ${i % 2 === 1 ? 'bg-gray-50/30' : ''}`}>
                          <div className="px-5 py-3">
                            <Link to={`/drugs/${drug.id}`} className="font-semibold text-sm text-indigo-700 hover:underline">
                              {drug.name}
                            </Link>
                          </div>
                          <div className="px-5 py-3 text-xs text-gray-500 font-mono">{drug.id}</div>
                          <div className="px-5 py-3 hidden md:block">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              drug.type === 'small molecule' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-purple-50 text-purple-700 border-purple-200'
                            }`}>
                              {drug.type}
                            </span>
                          </div>
                          <div className="px-5 py-3 hidden lg:block text-xs text-gray-600">
                            {drug.targets ? `${drug.targets} targets` : '—'}
                          </div>
                        </div>
                      ))}
                      {drugs.length > 8 && (
                        <div className="px-5 py-3 border-t border-gray-100">
                          <Link to="/drugs" className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
                            View all {groupName.toLowerCase()} drugs <ArrowRight size={10} />
                          </Link>
                        </div>
                      )}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── Footer CTA ── */}
      <div className="bg-gradient-to-r from-indigo-900 to-purple-900 text-white mt-10">
        <div className="max-w-7xl mx-auto px-4 py-10 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div>
            <h3 className="font-bold text-lg mb-1">Check Drug Interactions Now</h3>
            <p className="text-indigo-300 text-sm">Apply pharmacology knowledge in practice — check 24,386+ classified interaction pairs.</p>
          </div>
          <div className="flex gap-3 shrink-0">
            <Link to="/interactions"
              className="flex items-center gap-2 bg-white text-indigo-900 px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-indigo-50 transition-colors">
              <Zap size={15} className="text-amber-500" /> Check Interactions
            </Link>
            <Link to="/drugs"
              className="flex items-center gap-2 border border-white/30 text-white px-5 py-2.5 rounded-xl font-semibold text-sm hover:bg-white/10 transition-colors">
              <Pill size={14} /> Browse Drugs
            </Link>
          </div>
        </div>
      </div>

    </div>
  );
}
