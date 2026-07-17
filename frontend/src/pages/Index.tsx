import { useState } from "react";
import { Helmet } from "react-helmet-async";
import Navbar from "@/components/landing/Navbar";
import HeroSection, { MobilePreviewCards } from "@/components/landing/HeroSection";
import LandingDemo from "@/components/landing/LandingDemo";
import FeaturesSection from "@/components/landing/FeaturesSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import CTASection from "@/components/landing/CTASection";
import Footer from "@/components/landing/Footer";
import AuthModal from "@/components/auth/AuthModal";

const Index = () => {
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");

  const handleLoginClick = () => {
    setAuthMode("login");
    setIsAuthOpen(true);
  };

  const handleSignupClick = () => {
    setAuthMode("signup");
    setIsAuthOpen(true);
  };

  const toggleAuthMode = () => {
    setAuthMode(authMode === "login" ? "signup" : "login");
  };

  return (
    <>
      <Helmet>
        <title>Orca - No-Code Backtesting for Traders</title>
        <meta
          name="description"
          content="Professional backtesting without coding. Build, test, and optimize trading strategies with our visual strategy builder. Free to get started."
        />
      </Helmet>

      <div className="min-h-screen bg-background">
        <Navbar onLoginClick={handleLoginClick} onSignupClick={handleSignupClick} />
        <HeroSection onSignupClick={handleSignupClick} />
        <LandingDemo onSignupClick={handleSignupClick} />
        <MobilePreviewCards />
        <FeaturesSection />
        <HowItWorksSection />
        <CTASection onSignupClick={handleSignupClick} />
        <Footer />

        <AuthModal
          isOpen={isAuthOpen}
          onClose={() => setIsAuthOpen(false)}
          mode={authMode}
          onToggleMode={toggleAuthMode}
        />
      </div>
    </>
  );
};

export default Index;
