import { useState } from "react";
import { MailWarning, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

/** Soft verification nudge — shows only for logged-in users whose email is
 * unverified. Gates nothing; dismissible for the session. */
const VerifyEmailBanner = () => {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem("orca-verify-nudge-dismissed") === "1",
  );
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!user || user.email_verified !== false || dismissed) return null;

  const resend = async () => {
    setSending(true);
    try {
      await api.resendVerification();
      setSent(true);
      toast.success(`Verification email sent to ${user.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the email — try again shortly.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-2.5 text-xs">
      <MailWarning className="h-4 w-4 shrink-0 text-yellow-500" />
      <p className="flex-1 text-muted-foreground">
        <span className="font-medium text-foreground">Verify your email</span> so you can recover
        your account if you ever forget your password — we sent a link to {user.email}.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-7 shrink-0 text-[11px]"
        onClick={resend}
        disabled={sending || sent}
      >
        {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : sent ? "Sent ✓" : "Resend email"}
      </Button>
      <button
        onClick={() => {
          sessionStorage.setItem("orca-verify-nudge-dismissed", "1");
          setDismissed(true);
        }}
        aria-label="Dismiss"
        className="shrink-0 rounded p-1 text-muted-foreground/50 transition-colors hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

export default VerifyEmailBanner;
