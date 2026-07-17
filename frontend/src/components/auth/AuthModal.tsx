import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { X, Mail, Lock, User, ArrowRight, Eye, EyeOff, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import FinanceBackground, { TickerTape } from "@/components/effects/FinanceBackground";
import orcaLogo from "@/assets/orca-logo.png";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            element: HTMLElement,
            options: {
              type?: "standard" | "icon";
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              shape?: "rectangular" | "pill" | "circle" | "square";
              width?: number;
            },
          ) => void;
          cancel: () => void;
        };
      };
    };
  }
}

const fieldVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: "login" | "signup";
  onToggleMode: () => void;
  /** Optional signup subheading tailored to what the visitor just did. */
  signupContext?: string | null;
}

type AuthView = "form" | "forgot" | "forgot-sent";

const AuthModal = ({ isOpen, onClose, mode, onToggleMode, signupContext }: AuthModalProps) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [authView, setAuthView] = useState<AuthView>("form");
  const [forgotEmail, setForgotEmail] = useState("");
  const [isForgotSubmitting, setIsForgotSubmitting] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const { login, loginWithGoogle, signup } = useAuth();
  const rawGoogleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  // Treat the .env.example placeholder as unset so the button hides instead of
  // initialising Google's SDK with a fake client id (which renders broken).
  const googleClientId =
    rawGoogleClientId && !rawGoogleClientId.startsWith("your-") ? rawGoogleClientId : undefined;

  const pwLongEnough = password.length >= 8;
  const pwNotAllNumbers = password.length > 0 && !/^\d+$/.test(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || (mode === "signup" && !name.trim())) {
      toast.error("Please fill in all required fields");
      return;
    }
    if (mode === "signup" && !pwLongEnough) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (mode === "signup" && !pwNotAllNumbers) {
      toast.error("Password can't be entirely numbers.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === "login") {
        await login(email, password);
        toast.success("Welcome back!");
      } else {
        await signup(name, email, password);
        toast.success("Account created successfully!");
      }
      onClose();
      navigate("/dashboard");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong. Please try again.";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reset sub-view whenever the modal is closed or the login/signup mode changes.
  useEffect(() => {
    if (!isOpen) {
      setAuthView("form");
      setForgotEmail("");
    }
  }, [isOpen]);
  useEffect(() => {
    setAuthView("form");
  }, [mode]);

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim()) return;
    setIsForgotSubmitting(true);
    try {
      await api.forgotPassword(forgotEmail.trim());
      setAuthView("forgot-sent");
    } catch {
      // api.forgotPassword never throws a useful error (intentionally vague backend)
      setAuthView("forgot-sent");
    } finally {
      setIsForgotSubmitting(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !googleClientId || !googleButtonRef.current) return;

    let cancelled = false;

    const renderGoogleButton = () => {
      if (cancelled || !window.google || !googleButtonRef.current) return;

      googleButtonRef.current.innerHTML = "";
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: async (response) => {
          if (!response.credential) {
            toast.error("Google did not return a sign-in token.");
            return;
          }

          setIsGoogleLoading(true);
          try {
            await loginWithGoogle(response.credential);
            toast.success(mode === "signup" ? "Account connected with Google" : "Signed in with Google");
            onClose();
            navigate("/dashboard");
          } catch (error) {
            const message = error instanceof Error ? error.message : "Google sign-in failed";
            toast.error(message);
          } finally {
            setIsGoogleLoading(false);
          }
        },
      });
      const width = Math.min(368, Math.floor(googleButtonRef.current.getBoundingClientRect().width || 368));
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: mode === "signup" ? "signup_with" : "signin_with",
        shape: "rectangular",
        width,
      });
    };

    if (window.google) {
      renderGoogleButton();
      return () => {
        cancelled = true;
        window.google?.accounts.id.cancel();
      };
    }

    const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    const script = existingScript ?? document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = renderGoogleButton;
    script.onerror = () => toast.error("Google sign-in script could not be loaded.");
    if (!existingScript) document.head.appendChild(script);

    return () => {
      cancelled = true;
      window.google?.accounts.id.cancel();
    };
  }, [googleClientId, isOpen, loginWithGoogle, mode, navigate, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
              <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center"
            >
          {/* Animated market backdrop */}
          <div onClick={onClose} className="absolute inset-0 overflow-hidden bg-background">
            <FinanceBackground />
            <div className="absolute inset-0 gradient-radial" />
            <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-transparent to-background/80" />
            <div className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent animate-scan-line" />
            <TickerTape />
          </div>

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="relative z-10 w-full max-w-md mx-4"
          >
            {/* Gradient glow behind the card */}
            <div className="absolute -inset-6 rounded-3xl bg-primary/10 blur-2xl animate-pulse-glow pointer-events-none" />

            {/* Gradient border wrapper */}
            <div className="relative rounded-2xl bg-gradient-to-b from-primary/40 via-border/60 to-border/40 p-px shadow-2xl">
              <div className="relative rounded-[calc(1rem-1px)] bg-card/85 p-8 backdrop-blur-xl">
              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute right-4 top-4 p-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>

              {/* Header */}
              <div className="text-center mb-8">
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4, delay: 0.1 }}
                  className="relative mx-auto mb-4 flex h-14 w-14 items-center justify-center"
                >
                  <div className="absolute inset-0 rounded-xl bg-primary/15 blur-md animate-pulse-glow" />
                  <img src={orcaLogo} alt="Orca" className="relative h-12 w-12 rounded-xl" />
                  <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary shadow-lg">
                    <TrendingUp className="h-3 w-3 text-primary-foreground" />
                  </div>
                </motion.div>
                <h2 className="text-2xl font-bold mb-2">
                  {authView === "forgot"
                    ? "Reset Password"
                    : authView === "forgot-sent"
                    ? "Check your email"
                    : mode === "login"
                    ? "Welcome Back"
                    : "Create Account"}
                </h2>
                <p className="text-muted-foreground">
                  {authView === "forgot"
                    ? "Enter your email and we'll send a reset link."
                    : authView === "forgot-sent"
                    ? `A reset link has been sent to ${forgotEmail} if that account exists.`
                    : mode === "login"
                    ? "Enter your credentials to access your dashboard"
                    : signupContext || "Create your free account to get started"}
                </p>
              </div>

              {/* Forgot-password sent confirmation */}
              {authView === "forgot-sent" ? (
                <div className="space-y-4 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
                    <Mail className="h-6 w-6 text-primary" />
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Check your inbox and click the link — it expires in 1 hour.
                  </p>
                  <Button
                    variant="outline"
                    className="w-full h-12"
                    onClick={() => setAuthView("form")}
                  >
                    Back to sign in
                  </Button>
                </div>
              ) : authView === "forgot" ? (
                /* Forgot-password form */
                <motion.form
                  onSubmit={handleForgotSubmit}
                  className="space-y-4"
                  initial="hidden"
                  animate="visible"
                  variants={{ visible: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } } }}
                >
                  <motion.div variants={fieldVariants} className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <Input
                      type="email"
                      placeholder="Email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      autoFocus
                      className="pl-10 h-12 bg-secondary border-border transition-shadow focus-visible:shadow-[0_0_16px_hsl(var(--primary)/0.25)]"
                    />
                  </motion.div>
                  <motion.div variants={fieldVariants}>
                    <Button type="submit" variant="hero" className="w-full h-12" disabled={isForgotSubmitting}>
                      {isForgotSubmitting ? "Sending…" : "Send Reset Link"}
                    </Button>
                  </motion.div>
                  <motion.div variants={fieldVariants} className="text-center">
                    <button
                      type="button"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setAuthView("form")}
                    >
                      Back to sign in
                    </button>
                  </motion.div>
                </motion.form>
              ) : (
                <>
                  {/* Normal login / signup form */}
                  <motion.form
                    onSubmit={handleSubmit}
                    className="space-y-4"
                    initial="hidden"
                    animate="visible"
                    variants={{
                      visible: { transition: { staggerChildren: 0.07, delayChildren: 0.15 } },
                    }}
                  >
                    {mode === "signup" && (
                      <motion.div variants={fieldVariants} className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="Full Name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="pl-10 h-12 bg-secondary border-border transition-shadow focus-visible:shadow-[0_0_16px_hsl(var(--primary)/0.25)]"
                        />
                      </motion.div>
                    )}

                    <motion.div variants={fieldVariants} className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                      <Input
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10 h-12 bg-secondary border-border transition-shadow focus-visible:shadow-[0_0_16px_hsl(var(--primary)/0.25)]"
                      />
                    </motion.div>

                    <motion.div variants={fieldVariants} className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                      <Input
                        type={showPassword ? "text" : "password"}
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10 pr-10 h-12 bg-secondary border-border transition-shadow focus-visible:shadow-[0_0_16px_hsl(var(--primary)/0.25)]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </motion.div>

                    {mode === "signup" && password.length > 0 && (
                      <div className="flex gap-4 px-1 -mt-1">
                        <span className={`flex items-center gap-1.5 text-xs transition-colors ${pwLongEnough ? "text-emerald-500" : "text-muted-foreground/60"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full transition-colors ${pwLongEnough ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                          8+ characters
                        </span>
                        <span className={`flex items-center gap-1.5 text-xs transition-colors ${pwNotAllNumbers ? "text-emerald-500" : "text-muted-foreground/60"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full transition-colors ${pwNotAllNumbers ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                          Not all numbers
                        </span>
                      </div>
                    )}

                    {mode === "login" && (
                      <motion.div variants={fieldVariants} className="text-right">
                        <button
                          type="button"
                          className="text-sm text-primary hover:underline"
                          onClick={() => setAuthView("forgot")}
                        >
                          Forgot password?
                        </button>
                      </motion.div>
                    )}

                    <motion.div variants={fieldVariants}>
                      <Button type="submit" variant="hero" className="w-full h-12 group" disabled={isSubmitting}>
                        {mode === "login" ? "Sign In" : "Create Account"}
                        <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                      </Button>
                    </motion.div>

                    {mode === "signup" && (
                      <motion.p variants={fieldVariants} className="text-center text-xs text-muted-foreground">
                        By creating an account you agree to our{" "}
                        <a href="/legal/terms" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          Terms
                        </a>{" "}
                        and{" "}
                        <a href="/legal/privacy" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          Privacy Policy
                        </a>
                        .
                      </motion.p>
                    )}
                  </motion.form>

                  {/* Divider + social sign-in (hidden entirely when Google isn't configured) */}
                  {googleClientId && (
                    <div className="relative my-6">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center text-sm">
                        <span className="bg-card px-4 text-muted-foreground">or continue with</span>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    {googleClientId && (
                      <div className="relative min-h-12">
                        <div ref={googleButtonRef} className="flex w-full justify-center" />
                        {isGoogleLoading && (
                          <div className="absolute inset-0 flex items-center justify-center rounded-md bg-card/70 text-sm text-muted-foreground">
                            Signing in...
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Toggle mode — hidden on forgot-password views */}
              {authView === "form" && (
                <p className="text-center mt-6 text-sm text-muted-foreground">
                  {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
                  <button onClick={onToggleMode} className="text-primary hover:underline font-medium">
                    {mode === "login" ? "Sign up" : "Sign in"}
                  </button>
                </p>
              )}
              </div>
            </div>
          </motion.div>
          </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AuthModal;
