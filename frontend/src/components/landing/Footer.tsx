import { Link } from "react-router-dom";
import orcaLogo from "@/assets/orca-logo.png";

const Footer = () => {
  return (
    <footer className="border-t border-border/50 py-12 bg-card/30">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Brand */}
          <div className="md:col-span-1">
            <Link to="/" className="flex items-center gap-2 mb-4">
              <img src={orcaLogo} alt="Orca Logo" className="h-9 w-9 rounded-lg" />
              <span className="text-xl font-bold tracking-tight">Orca</span>
            </Link>
            <p className="text-sm text-muted-foreground">
              Professional backtesting for traders who don't code.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="font-semibold mb-4">Product</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="#features" className="hover:text-foreground transition-colors">Features</a></li>
              <li><a href="#how-it-works" className="hover:text-foreground transition-colors">How It Works</a></li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h4 className="font-semibold mb-4">Resources</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link to="/dashboard/help" className="hover:text-foreground transition-colors">Help & Docs</Link></li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold mb-4">Legal</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link to="/legal/terms" className="hover:text-foreground transition-colors">Terms of Service</Link></li>
              <li><Link to="/legal/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link></li>
              <li><Link to="/legal/risk" className="hover:text-foreground transition-colors">Risk Disclosure</Link></li>
            </ul>
          </div>
        </div>

        {/* Financial disclaimer */}
        <div className="mb-8 rounded-lg border border-border/50 bg-card/40 p-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground/80">Disclaimer:</span> Orca is a research and
            educational tool and does not provide financial advice. Backtested, optimized, and
            paper-traded results are hypothetical, do not represent real trading, and are not a guarantee
            of future performance. Trading involves substantial risk of loss.{" "}
            <Link to="/legal/risk" className="underline hover:text-foreground">
              Read the full risk disclosure
            </Link>
            .
          </p>
        </div>

        <div className="pt-8 border-t border-border/50 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Orca. All rights reserved.
          </p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link to="/legal/risk" className="hover:text-foreground transition-colors">Risk Disclosure</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
