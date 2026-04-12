import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Header from './components/Header'
import Footer from './components/Footer'
import HomePage from './pages/HomePage'
import DrugsPage from './pages/DrugsPage'
import DrugDetailPage from './pages/DrugDetailPage'
import InteractionsPage from './pages/InteractionsPage'
import ProteinsPage from './pages/ProteinsPage'
import AnalysisPage from './pages/AnalysisPage'
import ResourcesPage from './pages/ResourcesPage'

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/drugs" element={<DrugsPage />} />
            <Route path="/drugs/:id" element={<DrugDetailPage />} />
            <Route path="/interactions" element={<InteractionsPage />} />
            <Route path="/proteins" element={<ProteinsPage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
            <Route path="/resources" element={<ResourcesPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        <Footer />
      </div>
    </BrowserRouter>
  )
}

export default App
