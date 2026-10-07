import { BrowserRouter, Route, Routes } from 'react-router-dom'
import LandingPage from './pages/LandingPage'
import MissionSetupPage from './pages/MissionSetupPage'
import ActiveMissionPage from './pages/ActiveMissionPage'
import EsimSetupPage from './pages/EsimSetupPage'
import TermsPage from './pages/TermsPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/mission/new" element={<MissionSetupPage />} />
        <Route path="/mission/esim" element={<EsimSetupPage />} />
        <Route path="/mission/active" element={<ActiveMissionPage />} />
        <Route path="/terms" element={<TermsPage />} />
        {/* Catch-all → landing */}
        <Route path="*" element={<LandingPage />} />
      </Routes>
    </BrowserRouter>
  )
}
