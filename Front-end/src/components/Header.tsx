import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search, Menu, X, ChevronDown, Pill, FlaskConical,
  Zap, BookOpen, BarChart2, LogIn, Bell, ArrowRight,
  LogOut, BarChart, UserCircle
} from 'lucide-react';
import { getDrugs } from '../lib/drugCache';
import { getProteins, type Protein } from '../lib/proteinCache';
import type { Drug } from '../types/drug';
import { useAuth, getUserInitials } from '../context/AuthContext';

type SearchMode = 'drug' | 'protein' | 'interaction';
type Suggestion =
  | { kind: 'drug'; item: Drug }
  | { kind: 'protein'; item: Protein };

const menuItems = [
  {
    label: 'Khám phá',
    children: [
      { label: 'Cơ sở dữ liệu thuốc', icon: <Pill size={16} />, to: '/drugs', desc: 'Tra cứu 17,590+ loại thuốc' },
      { label: 'Protein đích', icon: <FlaskConical size={16} />, to: '/proteins', desc: '5,309 protein mục tiêu' },
      { label: 'Tương tác thuốc', icon: <Zap size={16} />, to: '/interactions', desc: '1,128,500+ cặp tương tác' },
    ],
  },
  {
    label: 'Tài nguyên',
    children: [
      { label: 'Tài liệu khoa học', icon: <BookOpen size={16} />, to: '/resources', desc: 'Nghiên cứu & tài liệu tham khảo' },
    ],
  },
  {
    label: 'Công cụ',
    children: [
      { label: 'Phân tích & Kiểm tra', icon: <BarChart2 size={16} />, to: '/analysis', desc: 'Kiểm tra tương tác đa thuốc' },
    ],
  },
];

export default function Header() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('drug');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [dropdownRect, setDropdownRect] = useState<DOMRect | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  // Eagerly preload data so it's ready when user types
  useEffect(() => { getDrugs(); getProteins(); }, []);

  // Keep dropdown rect fresh when open
  useEffect(() => {
    if (!showDropdown) return;
    const update = () => { if (containerRef.current) setDropdownRect(containerRef.current.getBoundingClientRect()); };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [showDropdown]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close user menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Live search suggestions
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    setActiveIdx(-1);
    if (q.length < 2) { setSuggestions([]); setShowDropdown(false); return; }

    if (searchMode === 'protein') {
      getProteins().then(data => {
        const results = data
          .filter(p =>
            p.name.toLowerCase().includes(q) ||
            (p.gene_name && p.gene_name.toLowerCase().includes(q))
          )
          .slice(0, 7)
          .map(p => ({ kind: 'protein' as const, item: p }));
        setSuggestions(results);
        setShowDropdown(results.length > 0);
        if (results.length > 0 && containerRef.current) setDropdownRect(containerRef.current.getBoundingClientRect());
      });
    } else {
      getDrugs().then(data => {
        const results = data
          .filter(d =>
            d.name.toLowerCase().includes(q) ||
            (d.generic_name && d.generic_name.toLowerCase().includes(q)) ||
            (d.aliases && d.aliases.some(a => a.toLowerCase().includes(q)))
          )
          .slice(0, 7)
          .map(d => ({ kind: 'drug' as const, item: d }));
        setSuggestions(results);
        setShowDropdown(results.length > 0);
        if (results.length > 0 && containerRef.current) setDropdownRect(containerRef.current.getBoundingClientRect());
      });
    }
  }, [searchQuery, searchMode]);

  const navigateTo = (s: Suggestion) => {
    setShowDropdown(false);
    setSearchQuery('');
    setSuggestions([]);
    if (s.kind === 'drug') {
      navigate(searchMode === 'interaction' ? `/interactions` : `/drugs/${s.item.id}`);
    } else {
      navigate(`/proteins?q=${encodeURIComponent(s.item.name)}`);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeIdx >= 0 && suggestions[activeIdx]) {
      navigateTo(suggestions[activeIdx]);
      return;
    }
    setShowDropdown(false);
    const q = searchQuery.trim();
    if (!q) return;
    if (searchMode === 'protein') navigate(`/proteins?q=${encodeURIComponent(q)}`);
    else if (searchMode === 'interaction') navigate('/interactions');
    else navigate(`/drugs?q=${encodeURIComponent(q)}`);
    setSearchQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)); }
    else if (e.key === 'Escape') { setShowDropdown(false); setActiveIdx(-1); }
  };

  // Portal dropdown — rendered in document.body to escape header stacking context
  const dropdownPortal = showDropdown && suggestions.length > 0 && dropdownRect
    ? createPortal(
        <div
          style={{
            position: 'fixed',
            top: dropdownRect.bottom + 4,
            left: dropdownRect.left,
            width: dropdownRect.width,
            zIndex: 99999,
          }}
          className="bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
        >
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onMouseDown={e => { e.preventDefault(); navigateTo(s); }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors border-b border-gray-50 last:border-0 ${
                i === activeIdx ? 'bg-blue-50' : 'hover:bg-gray-50'
              }`}
            >
              {s.kind === 'drug' ? (
                <>
                  <Pill size={14} className="text-blue-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-gray-800 text-sm font-medium truncate block">{s.item.name}</span>
                    {s.item.generic_name && s.item.generic_name !== s.item.name && (
                      <span className="text-gray-400 text-xs truncate block">{s.item.generic_name}</span>
                    )}
                  </div>
                  <span className="text-xs text-blue-700 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full shrink-0 capitalize">
                    {s.item.groups?.[0] ?? s.item.type ?? 'drug'}
                  </span>
                </>
              ) : (
                <>
                  <FlaskConical size={14} className="text-emerald-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-gray-800 text-sm font-medium truncate block">{s.item.name}</span>
                    {s.item.gene_name && <span className="text-gray-400 text-xs">{s.item.gene_name}</span>}
                  </div>
                  <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full shrink-0">Protein</span>
                </>
              )}
              <ArrowRight size={12} className="text-gray-300 shrink-0" />
            </button>
          ))}
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-400 flex items-center gap-1.5">
            <Search size={11} />
            Nhấn Enter xem tất cả · ↑↓ di chuyển · Esc đóng
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
    <header className="sticky top-0 z-50 shadow-lg">
      {/* Main header */}
      <div className="bg-primary-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center shadow">
              <Pill size={22} className="text-primary-800" />
            </div>
            <div className="leading-tight">
              <span className="text-white font-bold text-xl tracking-tight">MediDB</span>
              <span className="block text-blue-300 text-[10px] font-medium -mt-0.5">Clinical Decision Support</span>
            </div>
          </Link>

          {/* Search bar */}
          <div ref={containerRef} className="flex-1 max-w-2xl mx-auto">
            <form onSubmit={handleSearch}>
              <div className="flex rounded-lg overflow-hidden shadow-sm border-2 border-primary-600 focus-within:border-blue-300 transition-colors">
                <select
                  value={searchMode}
                  onChange={e => setSearchMode(e.target.value as SearchMode)}
                  className="bg-primary-700 text-white text-sm px-3 border-r border-primary-600 outline-none cursor-pointer min-w-[100px]"
                >
                  <option value="drug">Thuốc</option>
                  <option value="protein">Protein</option>
                  <option value="interaction">Tương tác</option>
                </select>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onFocus={() => { if (suggestions.length > 0) { setShowDropdown(true); if (containerRef.current) setDropdownRect(containerRef.current.getBoundingClientRect()); } }}
                  placeholder={
                    searchMode === 'protein' ? 'Tên protein, gene...' :
                    searchMode === 'interaction' ? 'Tên thuốc...' :
                    'Tên thuốc, hoạt chất...'
                  }
                  className="flex-1 bg-white text-gray-800 px-4 py-2.5 text-sm outline-none placeholder-gray-400"
                  autoComplete="off"
                />
                <button
                  type="submit"
                  className="bg-blue-400 hover:bg-blue-300 text-primary-900 px-5 font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Search size={16} />
                  <span className="hidden sm:inline text-sm">Tìm</span>
                </button>
              </div>

            </form>
          </div>

          {/* Auth */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <button className="text-blue-200 hover:text-white p-2 rounded-lg hover:bg-primary-700 transition-colors">
              <Bell size={18} />
            </button>
            {user ? (
              <div ref={userMenuRef} className="relative">
                <button
                  onClick={() => setUserMenuOpen(o => !o)}
                  className="flex items-center gap-2 hover:bg-primary-700 px-2 py-1.5 rounded-lg transition-colors group"
                >
                  {/* Avatar circle */}
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm shrink-0"
                    style={{ backgroundColor: user.avatar_color ?? '#4F46E5' }}
                  >
                    {getUserInitials(user)}
                  </div>
                  <span className="text-white text-sm font-medium max-w-[100px] truncate">{user.full_name}</span>
                  <ChevronDown size={13} className={`text-blue-300 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 bg-white rounded-xl shadow-2xl border border-gray-100 py-2 min-w-[200px] z-50">
                    {/* User info */}
                    <div className="px-4 py-3 border-b border-gray-100">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                          style={{ backgroundColor: user.avatar_color ?? '#4F46E5' }}
                        >
                          {getUserInitials(user)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-gray-900 font-semibold text-sm truncate">{user.full_name}</p>
                          <p className="text-gray-500 text-xs truncate">@{user.username}</p>
                        </div>
                      </div>
                    </div>
                    {/* Menu items */}
                    <Link
                      to="/analysis"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <BarChart size={14} className="text-indigo-500" />
                      Phân tích của tôi
                    </Link>
                    <Link
                      to="/profile"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <UserCircle size={14} className="text-blue-500" />
                      Hồ sơ cá nhân
                    </Link>
                    <div className="border-t border-gray-100 mt-1 pt-1">
                      <button
                        onClick={() => { logout(); setUserMenuOpen(false); navigate('/'); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <LogOut size={14} />
                        Đăng xuất
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Link
                  to="/login"
                  className="flex items-center gap-1.5 text-white border border-blue-400 hover:bg-blue-400 hover:text-primary-900 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                >
                  <LogIn size={15} />
                  Đăng nhập
                </Link>
                <Link
                  to="/register"
                  className="flex items-center gap-1.5 bg-blue-400 hover:bg-blue-300 text-primary-900 px-4 py-2 rounded-lg text-sm font-bold transition-all shadow"
                >
                  Đăng ký
                </Link>
              </>
            )}
          </div>

          {/* Mobile toggle */}
          <button
            className="md:hidden text-white p-2 rounded-lg hover:bg-primary-700 transition-colors"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Navigation bar */}
      <nav className="bg-primary-900 hidden md:block">
        <div className="max-w-7xl mx-auto px-4 flex items-center gap-1">
          {menuItems.map(item => (
            <div
              key={item.label}
              className="relative group"
              onMouseEnter={() => setOpenMenu(item.label)}
              onMouseLeave={() => setOpenMenu(null)}
            >
              <button className="flex items-center gap-1.5 text-blue-100 hover:text-white hover:bg-primary-700 px-4 py-3 text-sm font-medium transition-colors rounded-sm">
                {item.label}
                <ChevronDown size={14} className={`transition-transform duration-200 ${openMenu === item.label ? 'rotate-180' : ''}`} />
              </button>

              {openMenu === item.label && item.children && (
                <div className="absolute top-full left-0 mt-0 bg-white rounded-xl shadow-2xl border border-gray-100 py-2 min-w-[260px] z-50 animate-fade-in">
                  {item.children.map(child => (
                    <Link
                      key={child.to}
                      to={child.to}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-primary-50 transition-colors group/item"
                      onClick={() => setOpenMenu(null)}
                    >
                      <span className="mt-0.5 text-primary-700 group-hover/item:text-primary-900">{child.icon}</span>
                      <div>
                        <div className="text-gray-800 font-medium text-sm group-hover/item:text-primary-800">{child.label}</div>
                        <div className="text-gray-500 text-xs mt-0.5">{child.desc}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Quick links */}
          <div className="ml-auto flex items-center gap-0.5">
            {[
              { label: 'Thuốc', to: '/drugs' },
              { label: 'Tương tác', to: '/interactions' },
              { label: 'Protein', to: '/proteins' },
              { label: 'Phân tích', to: '/analysis' },
            ].map(link => (
              <Link
                key={link.to}
                to={link.to}
                className="text-blue-200 hover:text-white hover:bg-primary-700 px-3 py-3 text-xs font-medium transition-colors rounded-sm"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-primary-900 border-t border-primary-700 px-4 py-3 space-y-1">
          {menuItems.map(item => (
            <div key={item.label}>
              <div className="text-blue-300 text-xs font-semibold uppercase tracking-wider px-2 pt-2 pb-1">{item.label}</div>
              {item.children?.map(child => (
                <Link
                  key={child.to}
                  to={child.to}
                  className="flex items-center gap-2 text-blue-100 hover:text-white hover:bg-primary-700 px-3 py-2 rounded-lg text-sm transition-colors"
                  onClick={() => setMobileOpen(false)}
                >
                  {child.icon}
                  {child.label}
                </Link>
              ))}
            </div>
          ))}
          <div className="border-t border-primary-700 pt-3 flex gap-2">
            {user ? (
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2 px-2 pb-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ backgroundColor: user.avatar_color ?? '#4F46E5' }}
                  >
                    {getUserInitials(user)}
                  </div>
                  <div>
                    <p className="text-white text-sm font-semibold">{user.full_name}</p>
                    <p className="text-blue-300 text-xs">@{user.username}</p>
                  </div>
                </div>
                <button
                  onClick={() => { logout(); setMobileOpen(false); navigate('/'); }}
                  className="w-full flex items-center gap-2 text-red-400 hover:bg-primary-700 px-3 py-2 rounded-lg text-sm"
                >
                  <LogOut size={15} /> Đăng xuất
                </button>
              </div>
            ) : (
              <>
                <Link to="/login" className="flex-1 text-center border border-blue-400 text-white py-2 rounded-lg text-sm font-medium" onClick={() => setMobileOpen(false)}>Đăng nhập</Link>
                <Link to="/register" className="flex-1 text-center bg-blue-400 text-primary-900 py-2 rounded-lg text-sm font-bold" onClick={() => setMobileOpen(false)}>Đăng ký</Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
      {dropdownPortal}
    </>
  );
}
