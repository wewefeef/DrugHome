/**
 * Language Context — i18n for Vietnamese / English
 * Usage: const { t, lang, setLang } = useLanguage();
 *        <span>{t('nav.drugs')}</span>
 */
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type Lang = 'vi' | 'en';

// ── Translation dictionary ───────────────────────────────────────────────────
const translations: Record<Lang, Record<string, string>> = {
  en: {
    // Navigation
    'nav.explore': 'Explore',
    'nav.resources': 'Resources',
    'nav.tools': 'Tools',
    'nav.drugs': 'Drugs',
    'nav.interactions': 'Interactions',
    'nav.proteins': 'Proteins',
    'nav.analysis': 'Analysis',
    'nav.login': 'Login',
    'nav.logout': 'Logout',
    'nav.drugDatabase': 'Drug Database',
    'nav.targetProteins': 'Target Proteins',
    'nav.drugInteractions': 'Drug Interactions',
    'nav.scientificResources': 'Scientific Resources',
    'nav.analysisCheck': 'Analysis & Check',

    // Search
    'search.placeholder': 'Drug name, substance, DrugBank ID...',
    'search.button': 'Search',
    'search.drug': 'Drug',
    'search.protein': 'Protein',
    'search.interaction': 'Interaction',

    // HomePage
    'home.badge': 'Latest System',
    'home.title1': 'Intelligent Pharmaceutical',
    'home.title2': 'Information System',
    'home.subtitle': 'Search drugs, check interactions, analyze target proteins — all in one clinical decision support platform.',
    'home.liveData': 'Live data from the system',
    'home.liveDataSub': 'Continuously updated from DrugBank® and biomedical data sources',
    'home.drugs': 'Drugs',
    'home.drugsSub': 'Approved & experimental',
    'home.interactions': 'Drug Interactions',
    'home.interactionsSub': 'Unique interaction pairs',
    'home.targetProteins': 'Target Proteins',
    'home.targetProteinsSub': 'Molecular target proteins',
    'home.dpi': 'Drug-Protein Interactions',
    'home.dpiSub': 'Pharmacodynamic bindings',
    'home.features': 'Key Features',
    'home.featuresTitle': 'All pharmaceutical tools\nin one platform',
    'home.featuresSub': 'Built for students, researchers and healthcare professionals to look up and analyze pharmaceutical information.',
    'home.howItWorks': 'How it works',
    'home.howItWorksTitle': 'Just 4 simple steps',
    'home.step1': 'Search for a drug',
    'home.step1Desc': 'Enter the drug name, substance or DrugBank code in the search box.',
    'home.step2': 'View detailed info',
    'home.step2Desc': 'See full pharmacology, indications, contraindications and target proteins.',
    'home.step3': 'Check interactions',
    'home.step3Desc': 'Add multiple drugs to the list to check multi-directional interactions.',
    'home.step4': 'Analyze & Report',
    'home.step4Desc': 'Export analysis reports, risk assessments and clinical recommendations.',
    'home.popular': 'Most Popular',
    'home.popularTitle': 'Most frequently searched drugs',
    'home.viewAll': 'View all',
    'home.cta': 'Ready to explore the pharmaceutical system?',
    'home.ctaSub': 'Start searching drugs, checking interactions and analyzing pharmacology now — free for academic use.',
    'home.ctaSearch': 'Search drugs now',
    'home.ctaCheck': 'Check interactions',

    // DrugsPage
    'drugs.title': 'Drug Database',
    'drugs.breadcrumb': 'Drug Database',
    'drugs.loading': 'Loading drugs from DrugBank...',
    'drugs.noResults': 'No results found',
    'drugs.noResultsSub': 'Try a different search or clear the filters',
    'drugs.showing': 'Showing',
    'drugs.of': 'of',
    'drugs.results': 'results',

    // ProteinsPage
    'proteins.title': 'Proteins & Targets',
    'proteins.subtitle': 'Human proteins involved in pharmacology — targets, enzymes, transporters, carriers',
    'proteins.loading': 'Loading protein database...',
    'proteins.noResults': 'No results found',
    'proteins.searchPlaceholder': 'Search protein name, gene name, action...',
    'proteins.allTypes': 'All types',
    'proteins.targets': 'Targets',
    'proteins.enzymes': 'Enzymes',
    'proteins.transporters': 'Transporters',
    'proteins.carriers': 'Carriers',

    // InteractionsPage
    'interactions.title': 'Drug Interaction Network',
    'interactions.subtitle': 'Molecular network visualization · 33,227 protein links · Click a drug to start',
    'interactions.searchDrug': 'Search Drug',
    'interactions.selected': 'Selected',
    'interactions.diseaseCategories': 'Disease Categories',
    'interactions.analyze': 'Analyze Interactions',
    'interactions.noDrug': 'No Drug Selected',
    'interactions.noDrugSub': 'Search for a drug on the left or select from Disease Categories. The network will build automatically.',
    'interactions.mechanism': 'Mechanism of Action',

    // AnalysisPage
    'analysis.title': 'Analysis & History',
    'analysis.sessionHistory': 'Session History',
    'analysis.statistics': 'Statistics',
    'analysis.savedSessions': 'Saved Sessions',
    'analysis.interactionsChecked': 'Interactions Checked',
    'analysis.highRisk': 'High Risk Pairs',
    'analysis.moderate': 'Moderate Pairs',

    // Footer
    'footer.explore': 'Explore',
    'footer.resources': 'Resources',
    'footer.about': 'About',
    'footer.copyright': '© 2025 MediDB. Data from DrugBank® licensed for academic use.',
    'footer.poweredBy': 'Powered by FastAPI + React + DrugBank',

    // Common
    'common.loading': 'Loading...',
    'common.error': 'Error',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.viewDetails': 'Explore',

    // Features section
    'home.feat.drugDb': 'Drug Database',
    'home.feat.drugDbDesc': 'Detailed drug information: mechanism of action, indications, contraindications, pharmacokinetics and clinical data.',
    'home.feat.drugH1': 'Full FDA data',
    'home.feat.drugH2': 'Mechanism of action',
    'home.feat.drugH3': 'Pharmacokinetics',
    'home.feat.drugH4': 'ATC classification',
    'home.feat.checker': 'Interaction Checker',
    'home.feat.checkerDesc': 'Analyze interactions between multiple drugs simultaneously, classify severity levels and provide clinical recommendations.',
    'home.feat.checkH1': 'Multi-drug checker',
    'home.feat.checkH2': 'Risk classification',
    'home.feat.checkH3': 'Interaction mechanism',
    'home.feat.checkH4': 'Clinical alerts',
    'home.feat.proteins': 'Target Proteins',
    'home.feat.proteinsDesc': 'Explore molecular target protein data, gene information, structures and relationships with therapeutic drugs.',
    'home.feat.protH1': 'UniProt data',
    'home.feat.protH2': '3D structure',
    'home.feat.protH3': 'Gene info',
    'home.feat.protH4': 'Drug binding',
    'home.feat.analysis': 'Analysis Tools',
    'home.feat.analysisDesc': 'Comprehensive drug profile analysis, interaction report generation and intelligent clinical decision support.',
    'home.feat.anaH1': 'Multi-drug analysis',
    'home.feat.anaH2': 'PDF reports',
    'home.feat.anaH3': 'Risk scoring',
    'home.feat.anaH4': 'Smart CDS',
  },

  vi: {
    // Navigation
    'nav.explore': 'Khám phá',
    'nav.resources': 'Tài nguyên',
    'nav.tools': 'Công cụ',
    'nav.drugs': 'Thuốc',
    'nav.interactions': 'Tương tác',
    'nav.proteins': 'Protein',
    'nav.analysis': 'Phân tích',
    'nav.login': 'Đăng nhập',
    'nav.logout': 'Đăng xuất',
    'nav.drugDatabase': 'Cơ sở dữ liệu thuốc',
    'nav.targetProteins': 'Protein đích',
    'nav.drugInteractions': 'Tương tác thuốc',
    'nav.scientificResources': 'Tài nguyên khoa học',
    'nav.analysisCheck': 'Phân tích & Kiểm tra',

    // Search
    'search.placeholder': 'Tên thuốc, hoạt chất, mã DrugBank...',
    'search.button': 'Tìm kiếm',
    'search.drug': 'Thuốc',
    'search.protein': 'Protein',
    'search.interaction': 'Tương tác',

    // HomePage
    'home.badge': 'Hệ thống mới nhất',
    'home.title1': 'Hệ thống Thông tin',
    'home.title2': 'Dược phẩm Thông minh',
    'home.subtitle': 'Tra cứu thuốc, kiểm tra tương tác, phân tích protein đích — tất cả trong một nền tảng hỗ trợ quyết định lâm sàng.',
    'home.liveData': 'Dữ liệu trực tiếp từ hệ thống',
    'home.liveDataSub': 'Cập nhật liên tục từ DrugBank® và các nguồn dữ liệu y sinh',
    'home.drugs': 'Thuốc',
    'home.drugsSub': 'Đã phê duyệt & thử nghiệm',
    'home.interactions': 'Tương tác thuốc',
    'home.interactionsSub': 'Cặp tương tác duy nhất',
    'home.targetProteins': 'Protein đích',
    'home.targetProteinsSub': 'Protein mục tiêu phân tử',
    'home.dpi': 'Tương tác Thuốc-Protein',
    'home.dpiSub': 'Liên kết dược lực học',
    'home.features': 'Tính năng chính',
    'home.featuresTitle': 'Tất cả công cụ dược phẩm\ntrong một nền tảng',
    'home.featuresSub': 'Xây dựng cho sinh viên, nhà nghiên cứu và chuyên gia y tế để tra cứu và phân tích thông tin dược phẩm.',
    'home.howItWorks': 'Cách hoạt động',
    'home.howItWorksTitle': 'Chỉ 4 bước đơn giản',
    'home.step1': 'Tìm kiếm thuốc',
    'home.step1Desc': 'Nhập tên thuốc, hoạt chất hoặc mã DrugBank vào ô tìm kiếm.',
    'home.step2': 'Xem thông tin chi tiết',
    'home.step2Desc': 'Xem đầy đủ dược lý, chỉ định, chống chỉ định và protein đích.',
    'home.step3': 'Kiểm tra tương tác',
    'home.step3Desc': 'Thêm nhiều thuốc vào danh sách để kiểm tra tương tác đa chiều.',
    'home.step4': 'Phân tích & Báo cáo',
    'home.step4Desc': 'Xuất báo cáo phân tích, đánh giá rủi ro và khuyến nghị lâm sàng.',
    'home.popular': 'Phổ biến nhất',
    'home.popularTitle': 'Thuốc được tìm kiếm nhiều nhất',
    'home.viewAll': 'Xem tất cả',
    'home.cta': 'Sẵn sàng khám phá hệ thống dược phẩm?',
    'home.ctaSub': 'Bắt đầu tìm kiếm thuốc, kiểm tra tương tác và phân tích dược lý ngay — miễn phí cho mục đích học thuật.',
    'home.ctaSearch': 'Tìm thuốc ngay',
    'home.ctaCheck': 'Kiểm tra tương tác',

    // DrugsPage
    'drugs.title': 'Cơ sở dữ liệu thuốc',
    'drugs.breadcrumb': 'Cơ sở dữ liệu thuốc',
    'drugs.loading': 'Đang tải thuốc từ DrugBank...',
    'drugs.noResults': 'Không tìm thấy kết quả',
    'drugs.noResultsSub': 'Thử tìm kiếm khác hoặc xóa bộ lọc',
    'drugs.showing': 'Hiển thị',
    'drugs.of': 'trong',
    'drugs.results': 'kết quả',

    // ProteinsPage
    'proteins.title': 'Protein & Đích tác dụng',
    'proteins.subtitle': 'Protein người liên quan đến dược lý — đích, enzyme, vận chuyển, carrier',
    'proteins.loading': 'Đang tải cơ sở dữ liệu protein...',
    'proteins.noResults': 'Không tìm thấy kết quả',
    'proteins.searchPlaceholder': 'Tìm tên protein, gene, tác dụng...',
    'proteins.allTypes': 'Tất cả loại',
    'proteins.targets': 'Đích',
    'proteins.enzymes': 'Enzyme',
    'proteins.transporters': 'Vận chuyển',
    'proteins.carriers': 'Carrier',

    // InteractionsPage
    'interactions.title': 'Mạng lưới Tương tác Thuốc',
    'interactions.subtitle': 'Trực quan hóa mạng phân tử · 33.227 liên kết protein · Nhấn vào thuốc để bắt đầu',
    'interactions.searchDrug': 'Tìm thuốc',
    'interactions.selected': 'Đã chọn',
    'interactions.diseaseCategories': 'Nhóm bệnh',
    'interactions.analyze': 'Phân tích tương tác',
    'interactions.noDrug': 'Chưa chọn thuốc',
    'interactions.noDrugSub': 'Tìm thuốc ở bên trái hoặc chọn từ Nhóm bệnh. Mạng lưới sẽ tự động xây dựng.',
    'interactions.mechanism': 'Cơ chế tác dụng',

    // AnalysisPage
    'analysis.title': 'Phân tích & Lịch sử',
    'analysis.sessionHistory': 'Lịch sử phiên',
    'analysis.statistics': 'Thống kê',
    'analysis.savedSessions': 'Phiên đã lưu',
    'analysis.interactionsChecked': 'Tương tác đã kiểm tra',
    'analysis.highRisk': 'Cặp rủi ro cao',
    'analysis.moderate': 'Cặp trung bình',

    // Footer
    'footer.explore': 'Khám phá',
    'footer.resources': 'Tài nguyên',
    'footer.about': 'Giới thiệu',
    'footer.copyright': '© 2025 MediDB. Dữ liệu từ DrugBank® được cấp phép cho mục đích học thuật.',
    'footer.poweredBy': 'Xây dựng bằng FastAPI + React + DrugBank',

    // Common
    'common.loading': 'Đang tải...',
    'common.error': 'Lỗi',
    'common.save': 'Lưu',
    'common.cancel': 'Hủy',
    'common.close': 'Đóng',
    'common.viewDetails': 'Khám phá',

    // Features section
    'home.feat.drugDb': 'Cơ sở dữ liệu thuốc',
    'home.feat.drugDbDesc': 'Thông tin thuốc chi tiết: cơ chế tác dụng, chỉ định, chống chỉ định, dược động học và dữ liệu lâm sàng.',
    'home.feat.drugH1': 'Dữ liệu FDA đầy đủ',
    'home.feat.drugH2': 'Cơ chế tác dụng',
    'home.feat.drugH3': 'Dược động học',
    'home.feat.drugH4': 'Phân loại ATC',
    'home.feat.checker': 'Kiểm tra tương tác',
    'home.feat.checkerDesc': 'Phân tích tương tác giữa nhiều thuốc đồng thời, phân loại mức độ nghiêm trọng và đưa ra khuyến nghị lâm sàng.',
    'home.feat.checkH1': 'Kiểm tra đa thuốc',
    'home.feat.checkH2': 'Phân loại rủi ro',
    'home.feat.checkH3': 'Cơ chế tương tác',
    'home.feat.checkH4': 'Cảnh báo lâm sàng',
    'home.feat.proteins': 'Protein đích',
    'home.feat.proteinsDesc': 'Khám phá dữ liệu protein đích phân tử, thông tin gene, cấu trúc và mối quan hệ với thuốc điều trị.',
    'home.feat.protH1': 'Dữ liệu UniProt',
    'home.feat.protH2': 'Cấu trúc 3D',
    'home.feat.protH3': 'Thông tin gene',
    'home.feat.protH4': 'Liên kết thuốc',
    'home.feat.analysis': 'Công cụ phân tích',
    'home.feat.analysisDesc': 'Phân tích hồ sơ thuốc toàn diện, tạo báo cáo tương tác và hỗ trợ quyết định lâm sàng thông minh.',
    'home.feat.anaH1': 'Phân tích đa thuốc',
    'home.feat.anaH2': 'Báo cáo PDF',
    'home.feat.anaH3': 'Chấm điểm rủi ro',
    'home.feat.anaH4': 'CDS thông minh',
  },
};

// ── Context ──────────────────────────────────────────────────────────────────

interface LanguageContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'en',
  setLang: () => {},
  t: (key) => key,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('medidb_lang');
    return (saved === 'vi' || saved === 'en') ? saved : 'en';
  });

  const setLang = (newLang: Lang) => {
    setLangState(newLang);
    localStorage.setItem('medidb_lang', newLang);
  };

  const t = (key: string): string => {
    return translations[lang][key] || translations['en'][key] || key;
  };

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
