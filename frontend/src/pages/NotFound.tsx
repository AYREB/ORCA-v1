import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import FinanceBackground from "@/components/effects/FinanceBackground";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <FinanceBackground />
        <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-transparent to-background/85" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="relative z-10 mx-4 w-full max-w-md"
      >
        <div className="absolute -inset-6 rounded-3xl bg-primary/10 blur-2xl animate-pulse-glow pointer-events-none" />
        <div className="relative rounded-2xl bg-gradient-to-b from-primary/40 via-border/60 to-border/40 p-px shadow-2xl">
          <div className="relative rounded-[calc(1rem-1px)] bg-card/85 p-10 text-center backdrop-blur-xl">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10">
              <Compass className="h-7 w-7 text-primary" />
            </div>
            <h1 className="mb-2 font-mono text-5xl font-bold text-gradient-primary">404</h1>
            <p className="mb-1 text-lg font-semibold">Page not found</p>
            <p className="mb-6 text-sm text-muted-foreground">
              The route <span className="font-mono text-foreground/80">{location.pathname}</span> doesn't
              exist or has moved.
            </p>
            <Button variant="hero" asChild>
              <Link to="/dashboard">
                <ArrowLeft className="h-4 w-4" />
                Back to Dashboard
              </Link>
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default NotFound;
