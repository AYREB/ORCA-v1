import { motion } from "framer-motion";
import { ArrowRight, BarChart3, Zap, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import FinanceBackground, { TickerTape } from "@/components/effects/FinanceBackground";

interface HeroSectionProps {
  onSignupClick: () => void;
}

const HeroSection = ({ onSignupClick }: HeroSectionProps) => {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
      {/* Animated market background */}
      <div className="absolute inset-0">
        <FinanceBackground />
        <div className="absolute inset-0 gradient-radial" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-transparent to-background" />
      </div>

      {/* Animated scan line */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent animate-scan-line" />
      </div>

      {/* Floating orbs */}
      <motion.div
        className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full bg-primary/5 blur-3xl"
        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 8, repeat: Infinity }}
      />
      <motion.div
        className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-accent/5 blur-3xl"
        animate={{ scale: [1.2, 1, 1.2], opacity: [0.2, 0.4, 0.2] }}
        transition={{ duration: 10, repeat: Infinity }}
      />

      {/* Live ticker tape */}
      <TickerTape />

      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/20 bg-primary/5 mb-8"
          >
            <Zap className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-primary">No Coding Required</span>
          </motion.div>

          {/* Heading */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-3xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6"
          >
            Backtest Your
            <br />
            <span className="text-gradient-primary">Trading Strategies</span>
            <br />
            Like a Pro
          </motion.h1>

          {/* Subheading */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto mb-8"
          >
            Institutional-grade backtesting without writing a single line of code. 
            Build, test, and optimize your strategies with our visual strategy builder.
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12"
          >
            <Button variant="hero" size="xl" onClick={onSignupClick}>
              Start Free Trial
              <ArrowRight className="h-5 w-5" />
            </Button>
          </motion.div>

          {/* Key facts */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="grid grid-cols-3 gap-8 max-w-2xl mx-auto"
          >
            {[
              { value: "Custom", label: "Indicator Builder" },
              { value: "20yr", label: "Daily Chart Data" },
              { value: "Free", label: "To Get Started" },
            ].map((stat, index) => (
              <div key={index} className="text-center">
                <div className="text-xl md:text-2xl font-bold font-mono text-primary">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </motion.div>
        </div>

        {/* Preview Cards */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.5 }}
          className="mt-20 relative"
        >
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent z-10 pointer-events-none" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl mx-auto">
            <PreviewCard
              icon={<BarChart3 className="h-5 w-5 text-primary" />}
              title="Visual Strategy Builder"
              description="Drag and drop indicators to build complex strategies"
              delay={0.6}
            />
            <PreviewCard
              icon={<Zap className="h-5 w-5 text-success" />}
              title="Lightning Fast"
              description="Run years of backtests in seconds"
              delay={0.7}
            />
            <PreviewCard
              icon={<Shield className="h-5 w-5 text-warning" />}
              title="Risk Analysis"
              description="Comprehensive metrics and drawdown analysis"
              delay={0.8}
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
};

const PreviewCard = ({ icon, title, description, delay }: { icon: React.ReactNode; title: string; description: string; delay: number }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5, delay }}
    className="group relative rounded-xl bg-gradient-to-b from-primary/30 via-border/60 to-border/40 p-px transition-shadow hover:shadow-[0_0_24px_hsl(var(--primary)/0.15)]"
  >
    <div className="h-full rounded-[calc(0.75rem-1px)] bg-card/70 p-5 backdrop-blur-md">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 rounded-lg bg-secondary transition-colors group-hover:bg-primary/15">{icon}</div>
        <h3 className="font-semibold">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  </motion.div>
);

export default HeroSection;
