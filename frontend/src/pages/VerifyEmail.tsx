import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { MailCheck, MailX, Loader2, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import FinanceBackground, { TickerTape } from "@/components/effects/FinanceBackground";
import orcaLogo from "@/assets/orca-logo.png";

type Status = "verifying" | "success" | "error";

const VerifyEmail = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<Status>(token ? "verifying" : "error");
  const [message, setMessage] = useState<string>(
    token ? "" : "This link is missing a token. Please use the link from your email.",
  );
  const firedRef = useRef(false);
  const { refreshUser } = useAuth();

  useEffect(() => {
    if (!token || firedRef.current) return;
    firedRef.current = true; // React StrictMode double-mount guard — token is single-use
    api
      .verifyEmail(token)
      .then(() => {
        setStatus("success");
        refreshUser().catch(() => undefined); // banner vanishes without a reload
      })
      .catch((err) => {
        setStatus("error");
        setMessage(
          err instanceof Error ? err.message : "This verification link is invalid or has expired.",
        );
      });
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-background">
      <div className="absolute inset-0 overflow-hidden">
        <FinanceBackground />
        <div className="absolute inset-0 gradient-radial" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-transparent to-background/80" />
        <TickerTape />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md mx-4"
      >
        <div className="absolute -inset-6 rounded-3xl bg-primary/10 blur-2xl animate-pulse-glow pointer-events-none" />
        <div className="relative rounded-2xl bg-gradient-to-b from-primary/40 via-border/60 to-border/40 p-px shadow-2xl">
          <div className="relative rounded-[calc(1rem-1px)] bg-card/85 p-8 backdrop-blur-xl text-center">
            <div className="relative mx-auto mb-4 flex h-14 w-14 items-center justify-center">
              <div className="absolute inset-0 rounded-xl bg-primary/15 blur-md animate-pulse-glow" />
              <img src={orcaLogo} alt="Orca" className="relative h-12 w-12 rounded-xl" />
              <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary shadow-lg">
                <TrendingUp className="h-3 w-3 text-primary-foreground" />
              </div>
            </div>

            {status === "verifying" && (
              <>
                <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-primary" />
                <h2 className="text-2xl font-bold mb-2">Verifying…</h2>
                <p className="text-muted-foreground text-sm">One moment while we confirm your email.</p>
              </>
            )}

            {status === "success" && (
              <>
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success/10 border border-success/30">
                  <MailCheck className="h-6 w-6 text-success" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Email verified!</h2>
                <p className="text-muted-foreground text-sm mb-6">
                  Your account is fully set up — you can now recover it any time.
                </p>
                <Button variant="hero" className="w-full h-12" onClick={() => navigate("/dashboard")}>
                  Go to Dashboard
                </Button>
              </>
            )}

            {status === "error" && (
              <>
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 border border-destructive/30">
                  <MailX className="h-6 w-6 text-destructive" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Link expired</h2>
                <p className="text-muted-foreground text-sm mb-6">{message}</p>
                <p className="text-xs text-muted-foreground mb-4">
                  You can request a fresh link from the banner on your dashboard.
                </p>
                <Button variant="outline" className="w-full h-12" onClick={() => navigate("/dashboard")}>
                  Go to Dashboard
                </Button>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default VerifyEmail;
