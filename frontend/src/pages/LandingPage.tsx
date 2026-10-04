import Header from '../components/Header'
import Hero from '../components/Hero'
import MeasuredSection from '../components/MeasuredSection'
import ProblemSection from '../components/ProblemSection'
import HowItWorksSection from '../components/HowItWorksSection'
import CockpitPreview from '../components/CockpitPreview'
import TechnologySection from '../components/TechnologySection'
import FinalCTA from '../components/FinalCTA'
import Footer from '../components/Footer'
import StarfieldBackground from '../components/StarfieldBackground'

export default function LandingPage() {
  return (
    <>
      {/* Moving starfield + faint grid behind everything */}
      <StarfieldBackground />
      <div className="fixed inset-0 pointer-events-none fintech-grid z-0 opacity-60" />

      <Header />

      <main className="relative z-10 pt-20">
        <Hero />
        <MeasuredSection />
        <ProblemSection />
        <HowItWorksSection />
        <CockpitPreview />
        <TechnologySection />
        <FinalCTA />
      </main>

      <Footer />
    </>
  )
}
