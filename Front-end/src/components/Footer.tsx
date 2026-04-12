import { Link } from 'react-router-dom';
import { Pill, Mail, Code2, ExternalLink } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="bg-primary-950 text-gray-300">
      <div className="max-w-7xl mx-auto px-4 pt-12 pb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
          {/* Brand */}
          <div className="md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-primary-700 flex items-center justify-center">
                <Pill size={18} className="text-white" />
              </div>
              <span className="text-white font-bold text-lg">MediDB</span>
            </div>
            <p className="text-sm text-gray-400 leading-relaxed">
              Hệ thống thông tin dược phẩm thông minh hỗ trợ quyết định lâm sàng, được xây dựng từ dữ liệu DrugBank.
            </p>
            <div className="flex gap-3 mt-4">
              <a href="mailto:support@medidb.edu.vn" className="text-gray-400 hover:text-blue-300 transition-colors">
                <Mail size={18} />
              </a>
              <a href="#" className="text-gray-400 hover:text-blue-300 transition-colors">
                <Code2 size={18} />
              </a>
            </div>
          </div>

          {/* Khám phá */}
          <div>
            <h4 className="text-white font-semibold mb-4 text-sm uppercase tracking-wider">Khám phá</h4>
            <ul className="space-y-2.5 text-sm">
              {[
                { label: 'Cơ sở dữ liệu thuốc', to: '/drugs' },
                { label: 'Protein đích', to: '/proteins' },
                { label: 'Tương tác thuốc', to: '/interactions' },
                { label: 'Phân tích tương tác', to: '/analysis' },
              ].map(item => (
                <li key={item.to}>
                  <Link to={item.to} className="text-gray-400 hover:text-blue-300 transition-colors">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Tài nguyên */}
          <div>
            <h4 className="text-white font-semibold mb-4 text-sm uppercase tracking-wider">Tài nguyên</h4>
            <ul className="space-y-2.5 text-sm">
              {[
                { label: 'Tài liệu hướng dẫn', to: '/resources' },
                { label: 'API Reference', to: '/api-docs' },
                { label: 'DrugBank Database', href: 'https://www.drugbank.ca', external: true },
                { label: 'Báo cáo đồ án', to: '/report' },
              ].map(item => (
                <li key={item.label}>
                  {'href' in item ? (
                    <a href={item.href} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-300 transition-colors flex items-center gap-1">
                      {item.label} <ExternalLink size={11} />
                    </a>
                  ) : (
                    <Link to={(item as {to: string}).to} className="text-gray-400 hover:text-blue-300 transition-colors">
                      {item.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Thông tin */}
          <div>
            <h4 className="text-white font-semibold mb-4 text-sm uppercase tracking-wider">Thông tin</h4>
            <ul className="space-y-2.5 text-sm">
              {[
                { label: 'Giới thiệu dự án', to: '/about' },
                { label: 'Nhóm phát triển', to: '/team' },
                { label: 'Điều khoản sử dụng', to: '/terms' },
                { label: 'Chính sách bảo mật', to: '/privacy' },
              ].map(item => (
                <li key={item.to}>
                  <Link to={item.to} className="text-gray-400 hover:text-blue-300 transition-colors">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-gray-500">
          <span>© 2025 MediDB. Data from DrugBank® licensed for academic use.</span>
          <span className="text-primary-600">Powered by FastAPI + React + DrugBank</span>
        </div>
      </div>
    </footer>
  );
}
