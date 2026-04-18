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
    title: 'Dược động học (Pharmacokinetics)',
    subtitle: 'ADME — Hấp thu, Phân bố, Chuyển hóa, Thải trừ',
    summary: 'Nghiên cứu quá trình cơ thể xử lý thuốc theo thời gian. Bao gồm 4 giai đoạn ADME và các tham số lâm sàng quan trọng như AUC, Cmax, T½.',
    tags: ['ADME', 'Bioavailability', 'Half-life', 'Clearance', 'Volume of distribution'],
    keyPoints: [
      'Sinh khả dụng (F%) phản ánh tỷ lệ thuốc đến tuần hoàn hệ thống',
      'Thể tích phân bố (Vd) cho biết mức độ phân bố thuốc vào mô',
      'Độ thanh thải (CL) phụ thuộc chức năng thận và gan',
      'Thời gian bán thải (t½ = 0,693 × Vd / CL) quyết định liều lặp lại',
    ],
    formula: 't½ = 0.693 × Vd / CL',
    color_formula: 'text-blue-700 bg-blue-50',
  },
  {
    id: 'pd',
    icon: <Target size={22} className="text-purple-500" />,
    color: 'from-purple-50 to-violet-50 border-purple-200',
    accent: 'bg-purple-500',
    title: 'Dược lực học (Pharmacodynamics)',
    subtitle: 'Cơ chế tác dụng — Receptor — Signal transduction',
    summary: 'Nghiên cứu tác động của thuốc lên cơ thể — cơ chế phân tử, liên kết receptor, đường truyền tín hiệu và phản ứng sinh lý.',
    tags: ['Receptor binding', 'Agonist', 'Antagonist', 'EC50', 'Efficacy vs Potency'],
    keyPoints: [
      'Agonist đầy đủ: kích hoạt receptor đến mức tối đa',
      'Partial agonist: hiệu quả tối đa thấp hơn agonist nội sinh',
      'Competitive antagonist: tranh chấp vị trí gắn — có thể vượt qua bằng tăng nồng độ',
      'EC50 thể hiện nồng độ đạt 50% hiệu quả tối đa',
    ],
    formula: 'E = Emax × [C]^n / (EC50^n + [C]^n)',
    color_formula: 'text-purple-700 bg-purple-50',
  },
  {
    id: 'cyp',
    icon: <FlaskConical size={22} className="text-amber-500" />,
    color: 'from-amber-50 to-yellow-50 border-amber-200',
    accent: 'bg-amber-500',
    title: 'Enzyme CYP450 & Chuyển hóa thuốc',
    subtitle: 'CYP3A4 · CYP2D6 · CYP2C9 · CYP2C19 · CYP1A2',
    summary: 'Hệ enzyme Cytochrome P450 ở gan chịu trách nhiệm chuyển hóa >75% thuốc trên thị trường. Ức chế hoặc cảm ứng CYP gây ra phần lớn tương tác thuốc nghiêm trọng.',
    tags: ['CYP3A4', 'CYP2D6', 'Inhhibitor', 'Inducer', 'Substrate', 'Prodrug'],
    keyPoints: [
      'CYP3A4 chuyển hóa ~50% tất cả thuốc — bị ức chế bởi grapefruit juice',
      'CYP2D6 có đa hình di truyền: Poor/Intermediate/Extensive/Ultra-rapid Metabolizer',
      'Rifampicin là inducer CYP mạnh nhất — giảm hiệu quả nhiều thuốc',
      'Ketoconazole, clarithromycin là inhibitor CYP3A4 quan trọng lâm sàng',
    ],
    formula: 'Vm = Vmax × [S] / (Km + [S])',
    color_formula: 'text-amber-700 bg-amber-50',
  },
  {
    id: 'interaction',
    icon: <Zap size={22} className="text-red-500" />,
    color: 'from-red-50 to-rose-50 border-red-200',
    accent: 'bg-red-500',
    title: 'Tương tác thuốc — Drug Interactions',
    subtitle: 'PK interactions · PD interactions · Major vs Moderate vs Minor',
    summary: 'Tương tác thuốc xảy ra khi hiệu quả/độc tính của thuốc bị thay đổi bởi sự hiện diện của thuốc, thực phẩm hoặc chất khác. Phân loại theo cơ chế và mức độ lâm sàng.',
    tags: ['PK interaction', 'PD interaction', 'Synergy', 'Antagonism', 'Warfarin', 'Major'],
    keyPoints: [
      'Tương tác dược động học: thay đổi hấp thu, phân bố, chuyển hóa, thải trừ',
      'Tương tác dược lực học: cộng hưởng (additive) hoặc đối kháng (antagonism)',
      'Warfarin + NSAIDs: tăng nguy cơ xuất huyết — cần theo dõi INR',
      'ACE inhibitor + Kali: nguy cơ tăng kali huyết nghiêm trọng',
    ],
    formula: 'Risk = Σ(major × 3 + moderate × 1.5 + minor × 0.5)',
    color_formula: 'text-red-700 bg-red-50',
  },
  {
    id: 'therapeutic',
    icon: <Heart size={22} className="text-rose-500" />,
    color: 'from-rose-50 to-pink-50 border-rose-200',
    accent: 'bg-rose-500',
    title: 'Drug Classes theo Nhóm Bệnh',
    subtitle: 'Cardiovascular · CNS · Anti-infective · Oncology · Endocrine',
    summary: 'Phân loại thuốc theo ứng dụng điều trị giúp hiểu mối liên hệ giữa cơ chế tác dụng và bệnh lý mục tiêu — nền tảng của y học lâm sàng.',
    tags: ['ATC Code', 'WHO Essential', 'First-line', 'Monotherapy', 'Stepwise'],
    keyPoints: [
      'Hệ ATC (Anatomical Therapeutic Chemical) phân loại thuốc thành 5 cấp độ',
      'WHO Essential Medicines List 2023: 502 thuốc thiết yếu toàn cầu',
      'Thuốc tim mạch (C): beta-blocker, ACEi, statin — nhóm doanh thu lớn nhất',
      'Kháng sinh (J01): phân loại theo phổ tác dụng và cơ chế tác động vi khuẩn',
    ],
    formula: 'ATC Level 1→5: A → C02 → C02A → C02AA → C02AA01',
    color_formula: 'text-rose-700 bg-rose-50',
  },
  {
    id: 'clinical',
    icon: <Stethoscope size={22} className="text-teal-500" />,
    color: 'from-teal-50 to-emerald-50 border-teal-200',
    accent: 'bg-teal-500',
    title: 'Thử nghiệm lâm sàng & EBM',
    subtitle: 'Phase I–IV · RCT · NNT · NNH · Evidence grading',
    summary: 'Y học dựa vào bằng chứng (EBM) sử dụng kết quả từ thử nghiệm lâm sàng đối chứng ngẫu nhiên để hướng dẫn quyết định điều trị. Các chỉ số NNT/NNH đánh giá hiệu quả thực tế.',
    tags: ['RCT', 'Blinding', 'P-value', 'Confidence Interval', 'NNT', 'GRADE'],
    keyPoints: [
      'Phase I: an toàn, liều dung nạp — 20–100 tình nguyện viên khỏe mạnh',
      'Phase II: hiệu quả sơ bộ, tác dụng phụ — 100–300 bệnh nhân',
      'Phase III: hiệu quả, so sánh điều trị chuẩn — hàng nghìn bệnh nhân',
      'NNT = 1/ARR — số bệnh nhân cần điều trị để tránh 1 biến cố bất lợi',
    ],
    formula: 'NNT = 1 / (CER − EER)',
    color_formula: 'text-teal-700 bg-teal-50',
  },
];

const GLOSSARY: { term: string; def: string; category: string }[] = [
  { term: 'Bioavailability (F)', def: 'Phần trăm liều thuốc đưa vào cơ thể đạt được tuần hoàn hệ thống ở dạng không đổi. IV = 100%; uống thường < 100% do first-pass effect.', category: 'PK' },
  { term: 'Half-life (t½)', def: 'Thời gian để nồng độ thuốc trong huyết tương giảm còn 50%. Sau 4–5 t½ thuốc đạt trạng thái ổn định (steady-state).', category: 'PK' },
  { term: 'Clearance (CL)', def: 'Thể tích huyết tương được "làm sạch" thuốc mỗi đơn vị thời gian (L/h). Bao gồm hepatic CL và renal CL.', category: 'PK' },
  { term: 'Volume of Distribution (Vd)', def: 'Thể tích lý thuyết mà thuốc phân bố vào nếu nồng độ đồng nhất với huyết tương. Vd cao → phân bố vào mô nhiều.', category: 'PK' },
  { term: 'EC50', def: 'Nồng độ thuốc đạt 50% hiệu quả tối đa. Giá trị thấp → thuốc có potency cao hơn.', category: 'PD' },
  { term: 'Therapeutic Index (TI)', def: 'TI = TD50/ED50. Tỷ số giữa liều gây độc và liều có tác dụng. TI thấp (warfarin, digoxin, lithium) cần theo dõi nồng độ máu.', category: 'PD' },
  { term: 'Prodrug', def: 'Hợp chất dược lý không hoạt tính, chỉ có tác dụng sau khi được enzyme chuyển đổi thành dạng hoạt tính in vivo. Ví dụ: codeine → morphine (CYP2D6).', category: 'PK' },
  { term: 'First-pass Effect', def: 'Hiện tượng thuốc bị chuyển hóa tại gan hoặc ruột trước khi vào tuần hoàn chung, làm giảm sinh khả dụng khi dùng đường uống.', category: 'PK' },
  { term: 'Competitive Antagonist', def: 'Chất gắn vào cùng vị trí với agonist nhưng không kích hoạt receptor. Có thể bị vượt qua bằng tăng nồng độ agonist.', category: 'PD' },
  { term: 'Non-competitive Antagonist', def: 'Gắn vào vị trí dị lập thể hoặc cộng hóa trị với receptor. Giảm Emax, không thể vượt qua bằng tăng nồng độ agonist.', category: 'PD' },
  { term: 'Receptor Downregulation', def: 'Giảm số lượng receptor do tiếp xúc kéo dài với agonist. Cơ chế này giải thích hiện tượng tachyphylaxis và dung nạp thuốc.', category: 'PD' },
  { term: 'CYP Inhibition', def: 'Ức chế enzyme CYP450 làm giảm chuyển hóa substrate → tăng nồng độ thuốc → tăng tác dụng/độc tính tiềm ẩn.', category: 'Interaction' },
  { term: 'P-glycoprotein (P-gp)', def: 'Protein vận chuyển efflux tại ruột, BBB, thận. Giới hạn hấp thu và phân bố nhiều thuốc. Substrate: digoxin, dabigatran. Inhibitor: amiodarone.', category: 'PK' },
  { term: 'Protein Binding', def: 'Phần thuốc gắn với albumin và protein huyết tương. Chỉ dạng tự do có hoạt tính. Warfarin gắn 99% protein — tương tác có thể tăng dạng tự do nguy hiểm.', category: 'PK' },
  { term: 'NNT (Number Needed to Treat)', def: 'Số bệnh nhân cần điều trị để ngăn ngừa 1 biến cố bất lợi so với nhóm đối chứng. NNT thấp = hiệu quả điều trị cao.', category: 'EBM' },
  { term: 'Blood-Brain Barrier (BBB)', def: 'Hàng rào máu não do tế bào nội mô mao mạch não tạo thành. Chỉ cho phép các phân tử nhỏ, không phân cực, lipophilic đi qua.', category: 'PK' },
];

const ATC_GROUPS = [
  { code: 'A', label: 'Đường tiêu hóa & Chuyển hóa', color: 'bg-green-100 text-green-800 border-green-200', examples: ['Metformin', 'Omeprazole', 'Simvastatin'] },
  { code: 'B', label: 'Máu & Cơ quan tạo máu', color: 'bg-red-100 text-red-800 border-red-200', examples: ['Warfarin', 'Aspirin', 'Heparin'] },
  { code: 'C', label: 'Tim mạch', color: 'bg-pink-100 text-pink-800 border-pink-200', examples: ['Atorvastatin', 'Amlodipine', 'Lisinopril'] },
  { code: 'D', label: 'Da liễu', color: 'bg-orange-100 text-orange-800 border-orange-200', examples: ['Hydrocortisone', 'Tretinoin', 'Clotrimazole'] },
  { code: 'G', label: '泌尿sinh dục & Hormone sinh dục', color: 'bg-purple-100 text-purple-800 border-purple-200', examples: ['Sildenafil', 'Testosterone', 'Estradiol'] },
  { code: 'H', label: 'Hormone hệ thống', color: 'bg-yellow-100 text-yellow-800 border-yellow-200', examples: ['Levothyroxine', 'Prednisone', 'Insulin'] },
  { code: 'J', label: 'Kháng khuẩn — nhiễm khuẩn', color: 'bg-blue-100 text-blue-800 border-blue-200', examples: ['Amoxicillin', 'Ciprofloxacin', 'Azithromycin'] },
  { code: 'L', label: 'Chống ung thư & Điều miễn dịch', color: 'bg-indigo-100 text-indigo-800 border-indigo-200', examples: ['Methotrexate', 'Cyclophosphamide', 'Imatinib'] },
  { code: 'M', label: 'Cơ xương khớp', color: 'bg-teal-100 text-teal-800 border-teal-200', examples: ['Ibuprofen', 'Diclofenac', 'Allopurinol'] },
  { code: 'N', label: 'Hệ thần kinh', color: 'bg-violet-100 text-violet-800 border-violet-200', examples: ['Diazepam', 'Sertraline', 'Levodopa'] },
  { code: 'R', label: 'Hô hấp', color: 'bg-sky-100 text-sky-800 border-sky-200', examples: ['Salbutamol', 'Fluticasone', 'Montelukast'] },
  { code: 'S', label: 'Giác quan (Mắt/Tai)', color: 'bg-lime-100 text-lime-800 border-lime-200', examples: ['Timolol', 'Ciprofloxacin ophthalmic', 'Betamethasone'] },
];

const RESEARCH_ARTICLES = [
  {
    id: 1,
    badge: 'Dược động học',
    badgeColor: 'bg-blue-100 text-blue-700',
    title: 'Ảnh hưởng của đa hình CYP2D6 đến liều clopidogrel trong bệnh nhân tim mạch',
    authors: 'Mega JL, Close SL, Wiviott SD et al.',
    journal: 'NEJM', year: 2009, impact: '91.2',
    summary: 'Nghiên cứu phát hiện bệnh nhân mang allele mất chức năng CYP2D6 có hiệu quả kháng kết tập tiểu cầu của clopidogrel giảm đáng kể, tăng nguy cơ biến cố tim mạch.',
    tags: ['CYP2D6', 'Clopidogrel', 'Pharmacogenomics'],
    icon: <FlaskConical size={16} />,
    color: 'border-l-blue-500',
  },
  {
    id: 2,
    badge: 'Tương tác thuốc',
    badgeColor: 'bg-red-100 text-red-700',
    title: 'Tương tác Warfarin-NSAIDs và nguy cơ xuất huyết tiêu hóa: Meta-analysis',
    authors: 'Herings RM, Stricker BH, de Boer A et al.',
    journal: 'Lancet', year: 1995, impact: '168.9',
    summary: 'Phân tích gộp 12 nghiên cứu cho thấy dùng NSAID đồng thời với warfarin tăng nguy cơ nhập viện do xuất huyết tiêu hóa lên 15 lần so với nhóm chứng.',
    tags: ['Warfarin', 'NSAIDs', 'Drug Interaction', 'GI Bleeding'],
    icon: <AlertTriangle size={16} />,
    color: 'border-l-red-500',
  },
  {
    id: 3,
    badge: 'Thử nghiệm lâm sàng',
    badgeColor: 'bg-teal-100 text-teal-700',
    title: 'The JUPITER Trial: Rosuvastatin trong phòng ngừa bệnh tim mạch ở người CRP cao',
    authors: 'Ridker PM, Danielson E, Fonseca FA et al.',
    journal: 'NEJM', year: 2008, impact: '91.2',
    summary: 'RCT trên 17,802 bệnh nhân. Rosuvastatin 20mg giảm 44% biến cố tim mạch chính và 20% tử vong toàn nguyên nhân — buộc ngừng sớm vì lợi ích rõ ràng.',
    tags: ['Statin', 'CVD Prevention', 'RCT', 'NNT=25'],
    icon: <Heart size={16} />,
    color: 'border-l-teal-500',
  },
  {
    id: 4,
    badge: 'Dược lực học',
    badgeColor: 'bg-purple-100 text-purple-700',
    title: 'Cơ chế ức chế không cạnh tranh của Omeprazole tại H+/K+-ATPase dạ dày',
    authors: 'Wallmark B, Jarandi H, Kaul B.',
    journal: 'J Biological Chemistry', year: 1984, impact: '5.0',
    summary: 'Nghiên cứu cơ bản xác lập cơ chế ức chế không hồi phục của omeprazole — covalent bond với Cys813/Cys892 của H+/K+-ATPase, giải thích hiệu quả kéo dài trong điều trị loét.',
    tags: ['PPI', 'Omeprazole', 'Proton pump', 'Covalent inhibition'],
    icon: <Beaker size={16} />,
    color: 'border-l-purple-500',
  },
  {
    id: 5,
    badge: 'Dược di truyền',
    badgeColor: 'bg-amber-100 text-amber-700',
    title: 'Pharmacogenomics của HLA-B*57:01 và phản ứng quá mẫn Abacavir',
    authors: 'Mallal S, Nolan D, Witt C et al.',
    journal: 'Lancet', year: 2002, impact: '168.9',
    summary: 'Phát hiện liên kết mạnh mẽ giữa allele HLA-B*57:01 và hội chứng quá mẫn với abacavir (thuốc ARV HIV). Sàng lọc gen này trước điều trị giúp tránh hoàn toàn phản ứng nghiêm trọng.',
    tags: ['Pharmacogenomics', 'HIV', 'Abacavir', 'HLA typing'],
    icon: <Brain size={16} />,
    color: 'border-l-amber-500',
  },
  {
    id: 6,
    badge: 'Ung thư học',
    badgeColor: 'bg-indigo-100 text-indigo-700',
    title: 'Imatinib ức chế BCR-ABL tyrosine kinase trong bạch cầu mạn dòng tủy',
    authors: 'Druker BJ, Talpaz M, Resta DJ et al.',
    journal: 'NEJM', year: 2001, impact: '91.2',
    summary: 'Thử nghiệm lâm sàng landmark phase II. Imatinib đạt 53% complete hematologic response ở CML blast crisis — mở đầu kỷ nguyên targeted therapy trong ung thư học.',
    tags: ['Imatinib', 'CML', 'BCR-ABL', 'Targeted therapy'],
    icon: <Microscope size={16} />,
    color: 'border-l-indigo-500',
  },
];

const DRUG_FACTS_BASE = [
  { icon: <Database size={20} />, valueKey: 'drug_count' as const, label: 'Thuốc trong database', color: 'text-blue-600', fallback: '17,430' },
  { icon: <Zap size={20} />, valueKey: null, label: 'Cặp tương tác đã phân loại', color: 'text-red-600', fallback: '1,128,500+' },
  { icon: <Target size={20} />, valueKey: 'protein_count' as const, label: 'Protein đích (targets)', color: 'text-purple-600', fallback: '5,206' },
  { icon: <Globe size={20} />, valueKey: null, label: 'Quốc gia phê duyệt', color: 'text-teal-600', fallback: '100+' },
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
            <Link to="/" className="hover:text-white transition-colors">Trang chủ</Link>
            <ChevronRight size={14} />
            <span className="text-white font-medium">Tài nguyên khoa học</span>
          </nav>

          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-xs font-semibold px-3 py-1.5 rounded-full mb-5">
                <Microscope size={13} /> DrugBank® v5 · 2026 Edition
              </div>
              <h1 className="text-4xl lg:text-5xl font-extrabold leading-tight mb-4">
                Thư viện<br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 to-violet-300">Dược lý học</span>
              </h1>
              <p className="text-slate-300 text-base leading-relaxed mb-8 max-w-lg">
                Tổng hợp kiến thức dược động học, dược lực học, tương tác thuốc và bằng chứng lâm sàng — từ cơ bản đến nâng cao.
                Dữ liệu từ DrugBank, WHO và các nghiên cứu landmark.
              </p>
              <div className="flex flex-wrap gap-3">
                {(['topics', 'glossary', 'articles', 'atc', 'classes'] as const).map(s => ({
                  topics: { label: 'Chủ đề dược lý', icon: <BookOpen size={14} /> },
                  glossary: { label: 'Thuật ngữ', icon: <FileText size={14} /> },
                  articles: { label: 'Nghiên cứu tiêu biểu', icon: <Microscope size={14} /> },
                  atc: { label: 'Phân loại ATC', icon: <Layers size={14} /> },
                  classes: { label: 'Nhóm thuốc', icon: <Pill size={14} /> },
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
                    <p className="text-xs text-indigo-300 font-medium">Thuốc nổi bật</p>
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
              { id: 'topics', label: 'Chủ đề dược lý', icon: <BookOpen size={14} /> },
              { id: 'glossary', label: 'Thuật ngữ dược lý', icon: <FileText size={14} /> },
              { id: 'articles', label: 'Nghiên cứu tiêu biểu', icon: <Microscope size={14} /> },
              { id: 'atc', label: 'Phân loại ATC/WHO', icon: <Layers size={14} /> },
              { id: 'classes', label: 'Nhóm thuốc', icon: <Pill size={14} /> },
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
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Chủ đề dược lý cốt lõi</h2>
              <p className="text-gray-500 text-sm">Từ cơ bản đến nâng cao — nền tảng kiến thức cho mọi nhà lâm sàng</p>
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
                            <ShieldCheck size={14} className="text-gray-500" /> Điểm lâm sàng quan trọng
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
                            <Atom size={14} className="text-gray-500" /> Công thức cơ bản
                          </h4>
                          <div className={`rounded-xl p-4 font-mono text-sm font-bold border ${topic.color_formula}`}>
                            {topic.formula}
                          </div>
                          <div className="mt-4 bg-white/60 rounded-xl p-4 border border-gray-200/50">
                            <p className="text-xs text-gray-500 leading-relaxed">
                              <strong className="text-gray-700">Liên kết nhanh:</strong>{' '}
                              {topic.id === 'pk' && <><Link to="/drugs" className="text-indigo-600 hover:underline">Tra cứu thuốc → PK data</Link> · <Link to="/interactions" className="text-indigo-600 hover:underline">Kiểm tra tương tác</Link></>}
                              {topic.id === 'cyp' && <><Link to="/interactions" className="text-indigo-600 hover:underline">Xem cặp tương tác CYP</Link> · <Link to="/proteins" className="text-indigo-600 hover:underline">Protein CYP</Link></>}
                              {topic.id === 'interaction' && <><Link to="/interactions" className="text-indigo-600 hover:underline">Drug Interaction Checker</Link> · <Link to="/analysis" className="text-indigo-600 hover:underline">Lịch sử kiểm tra</Link></>}
                              {(topic.id === 'pd' || topic.id === 'therapeutic' || topic.id === 'clinical') && <><Link to="/drugs" className="text-indigo-600 hover:underline">Duyệt danh sách thuốc</Link> · <Link to="/proteins" className="text-indigo-600 hover:underline">Protein đích</Link></>}
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
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Thuật ngữ dược học</h2>
              <p className="text-gray-500 text-sm">Định nghĩa chuẩn các khái niệm dược lý — từ điển lâm sàng tham khảo nhanh</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <div className="flex-1 flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 shadow-sm focus-within:border-indigo-400 transition-colors">
                <Search size={15} className="text-gray-400 shrink-0" />
                <input value={glossarySearch} onChange={e => setGlossarySearch(e.target.value)}
                  placeholder="Tìm thuật ngữ..." className="flex-1 text-sm outline-none placeholder-gray-400" />
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
                  <p>Không tìm thấy thuật ngữ phù hợp</p>
                </div>
              )}
            </div>

            <div className="mt-6 bg-indigo-50 border border-indigo-200 rounded-2xl p-5 flex items-start gap-3">
              <Info size={16} className="text-indigo-500 mt-0.5 shrink-0" />
              <p className="text-sm text-indigo-700">
                <strong>Nguồn tham khảo:</strong> Goodman & Gilman's Pharmacology 14th Ed · Katzung Basic & Clinical Pharmacology 15th Ed · WHO Model Formulary · FDA Prescribing Information databases
              </p>
            </div>
          </div>
        )}

        {/* ════════════════ SECTION: RESEARCH ARTICLES ════════════════ */}
        {activeSection === 'articles' && (
          <div>
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Nghiên cứu lâm sàng tiêu biểu</h2>
              <p className="text-gray-500 text-sm">Các công trình landmark thay đổi thực hành dược lâm sàng và tim mạch học</p>
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
                      Kiểm tra thuốc liên quan <ArrowRight size={11} />
                    </Link>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 grid sm:grid-cols-3 gap-4">
              {[
                { icon: <Award size={20} />, label: 'Công trình Nobel Y học', value: '14 nghiên cứu thuốc', color: 'text-amber-500' },
                { icon: <Users size={20} />, label: 'Bệnh nhân trong thử nghiệm', value: '> 500,000', color: 'text-teal-500' },
                { icon: <TrendingUp size={20} />, label: 'Tỷ lệ thuốc FDA thành công', value: '~12% phase I', color: 'text-indigo-500' },
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
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Hệ thống phân loại ATC / WHO</h2>
              <p className="text-gray-500 text-sm max-w-2xl">
                Anatomical Therapeutic Chemical (ATC) — hệ thống phân loại quốc tế do WHO phát triển. Mã ATC 5 cấp xác định thuốc theo cơ quan đích, chỉ định điều trị và thành phần hóa học.
              </p>
            </div>

            {/* ATC structure explanation */}
            <div className="bg-gradient-to-r from-indigo-900 to-purple-900 rounded-2xl p-6 mb-8 text-white">
              <h3 className="font-bold mb-4 text-sm uppercase tracking-wide text-indigo-300">Cấu trúc mã ATC 5 cấp</h3>
              <div className="flex items-center gap-2 flex-wrap">
                {[
                  { level: '1', code: 'C', label: 'Giải phẫu', color: 'bg-blue-500' },
                  { level: '2', code: 'C10', label: 'Nhóm trị liệu', color: 'bg-indigo-500' },
                  { level: '3', code: 'C10A', label: 'Phân nhóm dược lý', color: 'bg-violet-500' },
                  { level: '4', code: 'C10AA', label: 'Phân nhóm hóa học', color: 'bg-purple-500' },
                  { level: '5', code: 'C10AA01', label: 'Hoạt chất (Simvastatin)', color: 'bg-fuchsia-500' },
                ].map((step, i) => (
                  <div key={step.level} className="flex items-center gap-2">
                    {i > 0 && <ChevronRight size={14} className="text-white/40 shrink-0" />}
                    <div className={`${step.color} rounded-xl px-4 py-2.5 text-center min-w-[100px]`}>
                      <div className="text-[10px] font-medium text-white/70 mb-0.5">Cấp {step.level}</div>
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
              <span>WHO cập nhật danh mục ATC hàng năm. Phiên bản hiện tại: <strong>WHO ATC 2024</strong>. Định nghĩa DDD (Defined Daily Dose) đi kèm để đánh giá mức tiêu thụ thuốc quốc gia.</span>
            </div>
          </div>
        )}

        {/* ════════════════ SECTION: DRUG CLASSES ════════════════ */}
        {activeSection === 'classes' && (
          <div>
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Nhóm thuốc từ cơ sở dữ liệu</h2>
              <p className="text-gray-500 text-sm">Dữ liệu thực từ DrugBank — phân loại theo loại phân tử và trạng thái phê duyệt</p>
            </div>

            {loadingDrugs ? (
              <div className="flex items-center justify-center py-20 text-gray-400 gap-3">
                <Activity size={18} className="animate-spin" /> Đang tải dữ liệu thuốc...
              </div>
            ) : (
              <div className="space-y-10">

                {/* Featured drugs grid */}
                <section>
                  <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <Star size={16} className="text-amber-500 fill-amber-400" />
                    Thuốc phê duyệt nổi bật — có cơ chế tác dụng đầy đủ
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
                          <span className="text-[11px] font-medium">Xem chi tiết</span>
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
                      Nhóm: <span className="text-indigo-700">{groupName}</span>
                      <span className="text-xs text-gray-400 font-normal">({drugs.length} mẫu)</span>
                    </h3>
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                      <div className="grid grid-cols-4 bg-gray-50 border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-wide">
                        <div className="px-5 py-3">Tên thuốc</div>
                        <div className="px-5 py-3">DrugBank ID</div>
                        <div className="px-5 py-3 hidden md:block">Loại phân tử</div>
                        <div className="px-5 py-3 hidden lg:block">Protein đích</div>
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
                            Xem tất cả {groupName.toLowerCase()} drugs <ArrowRight size={10} />
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
            <h3 className="font-bold text-lg mb-1">Kiểm tra tương tác thuốc ngay</h3>
            <p className="text-indigo-300 text-sm">Ứng dụng kiến thức dược lý vào thực hành — kiểm tra 24,386+ cặp tương tác đã phân loại.</p>
          </div>
          <div className="flex gap-3 shrink-0">
            <Link to="/interactions"
              className="flex items-center gap-2 bg-white text-indigo-900 px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-indigo-50 transition-colors">
              <Zap size={15} className="text-amber-500" /> Kiểm tra tương tác
            </Link>
            <Link to="/drugs"
              className="flex items-center gap-2 border border-white/30 text-white px-5 py-2.5 rounded-xl font-semibold text-sm hover:bg-white/10 transition-colors">
              <Pill size={14} /> Tra cứu thuốc
            </Link>
          </div>
        </div>
      </div>

    </div>
  );
}
