import {
  LayoutDashboard,
  FlaskConical,
  LineChart,
  History,
  Settings,
  HelpCircle,
  LogOut,
  ChevronLeft,
  Sliders,
  Wallet,
  Sigma,
  CandlestickChart,
  Sparkles,
  Shield,
  X
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import orcaLogo from "@/assets/orca-logo.png";
import { useAuth } from "@/context/AuthContext";

interface DashboardSidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  /** Mobile: drawer visibility (sidebar is off-canvas below md). */
  mobileOpen: boolean;
  onMobileClose: () => void;
}

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: CandlestickChart, label: "Charts", path: "/dashboard/charts" },
  { icon: FlaskConical, label: "New Backtest", path: "/dashboard/backtest" },
  { icon: Sliders, label: "Optimizers", path: "/dashboard/optimizers" },
  { icon: LineChart, label: "Strategies", path: "/dashboard/strategies" },
  { icon: Sigma, label: "Custom Indicators", path: "/dashboard/indicators" },
  { icon: Wallet, label: "Paper Accounts", path: "/dashboard/paper-accounts" },
  { icon: History, label: "History", path: "/dashboard/history" },
];

const bottomItems = [
  { icon: Sparkles, label: "Plans", path: "/dashboard/plans" },
  { icon: Settings, label: "Settings", path: "/dashboard/settings" },
  { icon: HelpCircle, label: "Help", path: "/dashboard/help" },
];

const DashboardSidebar = ({ isCollapsed, onToggle, mobileOpen, onMobileClose }: DashboardSidebarProps) => {
  const navigate = useNavigate();
  const { logout, user } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  // Below md the sidebar is an off-canvas drawer: always full width with
  // labels (collapse is a desktop concept), closed by default, slides in
  // over a backdrop. md+ is exactly the previous fixed sidebar.

  return (
    <aside
      className={`fixed left-0 top-0 z-40 h-screen border-r border-border/60 bg-card/95 backdrop-blur-xl transition-all duration-300 md:bg-card/55 ${
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      } md:translate-x-0 w-64 ${isCollapsed ? "md:w-16" : "md:w-64"}`}
    >
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b border-border/60 px-4">
          <div className={`flex items-center gap-2.5 ${isCollapsed ? "md:hidden" : ""}`}>
            <div className="relative">
              <div className="absolute inset-0 rounded-lg bg-primary/20 blur-md" />
              <img src={orcaLogo} alt="Orca Logo" className="relative h-8 w-8 rounded-lg" />
            </div>
            <span className="text-lg font-bold tracking-tight">Orca</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className={`hidden h-8 w-8 md:flex ${isCollapsed ? "md:mx-auto" : ""}`}
          >
            <ChevronLeft className={`h-4 w-4 transition-transform ${isCollapsed ? "rotate-180" : ""}`} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onMobileClose} className="h-8 w-8 md:hidden">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-2 py-4">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/dashboard"}
              title={isCollapsed ? item.label : undefined}
              onClick={onMobileClose}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all duration-200 hover:bg-secondary/80 hover:text-foreground ${
                isCollapsed ? "md:justify-center" : ""
              }`}
              activeClassName="bg-primary/10 text-primary border border-primary/20 shadow-[0_0_16px_-6px_hsl(var(--primary)/0.45)]"
            >
              <item.icon className="h-4 w-4 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" />
              <span className={`text-sm font-medium ${isCollapsed ? "md:hidden" : ""}`}>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Bottom items */}
        <div className="space-y-1 border-t border-border/60 px-2 py-4">
          {user && (
            <div className={`mb-2 flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5 ${isCollapsed ? "md:hidden" : ""}`}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                {(user.name || user.email || "?").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-medium">{user.name || "Trader"}</p>
                  {user.plan && (
                    <span className="shrink-0 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide text-primary">
                      {user.plan.label}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
            </div>
          )}

          {user?.is_superuser && (
            <NavLink
              to="/dashboard/admin"
              title={isCollapsed ? "Admin" : undefined}
              onClick={onMobileClose}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-amber-500/90 transition-colors hover:bg-amber-500/10 hover:text-amber-500 ${
                isCollapsed ? "md:justify-center" : ""
              }`}
              activeClassName="bg-amber-500/10 text-amber-500 border border-amber-500/20"
            >
              <Shield className="h-4 w-4 flex-shrink-0" />
              <span className={`text-sm font-medium ${isCollapsed ? "md:hidden" : ""}`}>Admin</span>
            </NavLink>
          )}

          {bottomItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              title={isCollapsed ? item.label : undefined}
              onClick={onMobileClose}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground ${
                isCollapsed ? "md:justify-center" : ""
              }`}
              activeClassName="bg-primary/10 text-primary border border-primary/20"
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              <span className={`text-sm font-medium ${isCollapsed ? "md:hidden" : ""}`}>{item.label}</span>
            </NavLink>
          ))}

          <button
            onClick={handleLogout}
            title={isCollapsed ? "Logout" : undefined}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive ${
              isCollapsed ? "md:justify-center" : ""
            }`}
          >
            <LogOut className="h-4 w-4 flex-shrink-0" />
            <span className={`text-sm font-medium ${isCollapsed ? "md:hidden" : ""}`}>Logout</span>
          </button>
        </div>
      </div>
    </aside>
  );
};

export default DashboardSidebar;
