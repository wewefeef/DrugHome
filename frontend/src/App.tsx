import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import Header from './components/Header'
import Footer from './components/Footer'
import HomePage from './pages/HomePage'
import DrugsPage from './pages/DrugsPage'
import DrugDetailPage from './pages/DrugDetailPage'
import InteractionsPage from './pages/InteractionsPage'
import ProteinsPage from './pages/ProteinsPage'
import AnalysisPage from './pages/AnalysisPage'
import ResourcesPage from './pages/ResourcesPage'
import AuthPage from './pages/AuthPage'
import { AuthProvider } from './context/AuthContext'

/** Wrapper layout: header + footer */
function MainLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="flex-1">
        <Outlet />
      </div>
      <Footer />
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Full-screen auth pages — no header / footer */}
          <Route path="/login" element={<AuthPage />} />
          <Route path="/register" element={<AuthPage />} />

          {/* Main site — with header + footer */}
          <Route element={<MainLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/drugs" element={<DrugsPage />} />
            <Route path="/drugs/:id" element={<DrugDetailPage />} />
            <Route path="/interactions" element={<InteractionsPage />} />
            <Route path="/proteins" element={<ProteinsPage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
            <Route path="/resources" element={<ResourcesPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
