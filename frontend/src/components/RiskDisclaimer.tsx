import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";

/**
 * Reusable financial risk disclaimer.
 *
 * - `banner`  — a visible amber callout for pages that present performance
 *   numbers (backtests, paper accounts, dashboard, history, charts).
 * - `inline`  — a one-line muted footnote for tight spaces.
 */
interface RiskDisclaimerProps {
  variant?: "banner" | "inline";
  className?: string;
}

const SHORT_TEXT =
  "Orca is a research and educational tool, not financial advice. Backtested and simulated results are hypothetical, do not represent real trading, and are not a guarantee of future performance.";

const RiskDisclaimer = ({ variant = "banner", className = "" }: RiskDisclaimerProps) => {
  if (variant === "inline") {
    return (
      <p className={`text-xs text-muted-foreground ${className}`}>
        {SHORT_TEXT}{" "}
        <Link to="/legal/risk" className="underline hover:text-foreground">
          Risk disclosure
        </Link>
        .
      </p>
    );
  }

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3 ${className}`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
      <p className="text-xs text-muted-foreground">
        {SHORT_TEXT} Trading involves substantial risk of loss.{" "}
        <Link to="/legal/risk" className="font-medium text-warning hover:underline">
          Read the full risk disclosure
        </Link>
        .
      </p>
    </div>
  );
};

export default RiskDisclaimer;
