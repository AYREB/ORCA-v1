import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Lock, Eye, EyeOff, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { api } from "@/lib/api";
import FinanceBackground, { TickerTape } from "@/components/effects/FinanceBackground";
import orcaLogo from "@/assets/orca-logo.png";

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";

  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3 p-8">
          <p className="text-lg font-semibold">Invalid reset link</p>
          <p className="text-sm text-muted-foreground">This link is missing a token. Please request a new one.</p>
          <Button variant="outline" onClick={() => navigate("/")}>Back to home</Button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPw || !confirmPw) {
      toast.error("Please fill in both fields.");
      return;
    }
    if (newPw !== confirmPw) {
      toast.error("Passwords don't match.");
      return;
    }
    setIsSubmitting(true);
    try {
      await api.resetPassword(token, newPw);
      setDone(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reset failed. The link may have expired.");
    } finally {
      setIsSubmitting(false);
    }
  };

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
          <div className="relative rounded-[calc(1rem-1px)] bg-card/85 p-8 backdrop-blur-xl">
            {/* Header */}
            <div className="text-center mb-8">
              <div className="relative mx-auto mb-4 flex h-14 w-14 items-center justify-center">
                <div className="absolute inset-0 rounded-xl bg-primary/15 blur-md animate-pulse-glow" />
                <img src={orcaLogo} alt="Orca" className="relative h-12 w-12 rounded-xl" />
                <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary shadow-lg">
                  <TrendingUp className="h-3 w-3 text-primary-foreground" />
                </div>
              </div>
              <h2 className="text-2xl font-bold mb-2">
                {done ? "Password reset!" : "Set new password"}
              </h2>
              <p className="text-muted-foreground text-sm">
                {done
                  ? "Your password has been updated. You can now sign in."
                  : "Choose a strong password for your Orca account."}
              </p>
            </div>

            {done ? (
              <Button variant="hero" className="w-full h-12" onClick={() => navigate("/")}>
                Back to sign in
              </Button>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    type={showPw ? "text" : "password"}
                    placeholder="New password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    autoFocus
                    className="pl-10 pr-10 h-12 bg-secondary border-border transition-shadow focus-visible:shadow-[0_0_16px_hsl(var(--primary)/0.25)]"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    type={showPw ? "text" : "password"}
                    placeholder="Confirm new password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    className="pl-10 h-12 bg-secondary border-border transition-shadow focus-visible:shadow-[0_0_16px_hsl(var(--primary)/0.25)]"
                    autoComplete="new-password"
                  />
                </div>
                <Button type="submit" variant="hero" className="w-full h-12" disabled={isSubmitting}>
                  {isSubmitting ? "Resetting…" : "Reset password"}
                </Button>
                <p className="text-center">
                  <button
                    type="button"
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => navigate("/")}
                  >
                    Back to sign in
                  </button>
                </p>
              </form>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default ResetPassword;
