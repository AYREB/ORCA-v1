import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, ArrowUpRight } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const PLAN_LABELS: Record<string, string> = { free: "Free", plus: "Plus", pro: "Pro" };

/**
 * Mounted once near the app root. Registers a global handler so that any API
 * call that 402s on a plan limit surfaces one consistent "upgrade" prompt —
 * no per-call-site wiring. The originating error is still thrown for local
 * handling (e.g. to stop a spinner).
 */
const PlanLimitDialog = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api.setPlanLimitHandler((err) => setError(err));
    return () => api.setPlanLimitHandler(null);
  }, []);

  const upgradeLabel = error?.upgradeTo ? PLAN_LABELS[error.upgradeTo] ?? "a higher plan" : null;

  return (
    <Dialog open={!!error} onOpenChange={(open) => !open && setError(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <DialogTitle>You've hit a plan limit</DialogTitle>
          <DialogDescription className="pt-1 text-sm leading-relaxed">
            {error?.message || "This action isn't available on your current plan."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-2 gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => setError(null)}>
            Not now
          </Button>
          <Button
            onClick={() => {
              setError(null);
              navigate("/dashboard/plans");
            }}
            className="gap-1.5"
          >
            {upgradeLabel ? `Upgrade to ${upgradeLabel}` : "View plans"}
            <ArrowUpRight className="h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PlanLimitDialog;
