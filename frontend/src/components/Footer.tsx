import { Link } from 'react-router-dom';
import { Pill, Mail, Code2, ExternalLink } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export default function Footer() {
  const { t } = useLanguage();
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
              {t('home.subtitle')}
            </p>
            <div className="flex gap-3 mt-4">
              <a href="mailto:support@medidb.edu.vn" className="text-gray-400 hover:text-blue-300 transition-colors">
                <Mail size={18} />
              </a>
              <a href="https://github.com/wewefeef/DrugHome" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-300 transition-colors">
                <Code2 size={18} />
              </a>
            </div>
          </div>

          {/* Explore */}
          <div>
            <h4 className="text-white font-semibold mb-4 text-sm uppercase tracking-wider">{t('footer.explore')}</h4>
            <ul className="space-y-2.5 text-sm">
              {[
                { label: t('nav.drugDatabase'), to: '/drugs' },
                { label: t('nav.targetProteins'), to: '/proteins' },
                { label: t('nav.drugInteractions'), to: '/interactions' },
                { label: t('nav.analysisCheck'), to: '/analysis' },
              ].map(item => (
                <li key={item.to}>
                  <Link to={item.to} className="text-gray-400 hover:text-blue-300 transition-colors">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h4 className="text-white font-semibold mb-4 text-sm uppercase tracking-wider">{t('footer.resources')}</h4>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link to="/resources" className="text-gray-400 hover:text-blue-300 transition-colors">
                  {t('nav.scientificResources')}
                </Link>
              </li>
              <li>
                <a href="https://www.drugbank.ca" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-300 transition-colors flex items-center gap-1">
                  DrugBank Database <ExternalLink size={11} />
                </a>
              </li>
            </ul>
          </div>

          {/* About */}
          <div>
            <h4 className="text-white font-semibold mb-4 text-sm uppercase tracking-wider">{t('footer.about')}</h4>
            <ul className="space-y-2.5 text-sm">
              <li>
                <a href="mailto:support@medidb.edu.vn" className="text-gray-400 hover:text-blue-300 transition-colors">
                  Contact us
                </a>
              </li>
              <li>
                <a href="https://www.drugbank.ca/legal/terms_of_service" target="_blank" rel="noopener noreferrer"
                   className="text-gray-400 hover:text-blue-300 transition-colors flex items-center gap-1">
                  DrugBank Terms <ExternalLink size={11} />
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-gray-500">
          <span>{t('footer.copyright')}</span>
          <span className="text-primary-600">{t('footer.poweredBy')}</span>
        </div>
      </div>
    </footer>
  );
}
