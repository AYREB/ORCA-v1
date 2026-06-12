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
  Sigma
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import orcaLogo from "@/assets/orca-logo.png";
import { useAuth } from "@/context/AuthContext";

interface DashboardSidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: FlaskConical, label: "New Backtest", path: "/dashboard/backtest" },
  { icon: Sliders, label: "Optimizers", path: "/dashboard/optimizers" },
  { icon: LineChart, label: "Strategies", path: "/dashboard/strategies" },
  { icon: Sigma, label: "Custom Indicators", path: "/dashboard/indicators" },
  { icon: Wallet, label: "Paper Accounts", path: "/dashboard/paper-accounts" },
  { icon: History, label: "History", path: "/dashboard/history" },
];

const bottomItems = [
  { icon: Settings, label: "Settings", path: "/dashboard/settings" },
  { icon: HelpCircle, label: "Help", path: "/dashboard/help" },
];

const DashboardSidebar = ({ isCollapsed, onToggle }: DashboardSidebarProps) => {
  const navigate = useNavigate();
  const { logout, user } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <aside
      className={`fixed left-0 top-0 z-40 h-screen border-r border-border/60 bg-card/55 backdrop-blur-xl transition-all duration-300 ${
        isCollapsed ? "w-16" : "w-64"
      }`}
    >
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b border-border/60 px-4">
          {!isCollapsed && (
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <div className="absolute inset-0 rounded-lg bg-primary/20 blur-md" />
                <img src={orcaLogo} alt="Orca Logo" className="relative h-8 w-8 rounded-lg" />
              </div>
              <span className="text-lg font-bold tracking-tight">Orca</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className={`h-8 w-8 ${isCollapsed ? "mx-auto" : ""}`}
          >
            <ChevronLeft className={`h-4 w-4 transition-transform ${isCollapsed ? "rotate-180" : ""}`} />
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
              className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all duration-200 hover:bg-secondary/80 hover:text-foreground ${
                isCollapsed ? "justify-center" : ""
              }`}
              activeClassName="bg-primary/10 text-primary border border-primary/20 shadow-[0_0_16px_-6px_hsl(var(--primary)/0.45)]"
            >
              <item.icon className="h-4 w-4 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" />
              {!isCollapsed && <span className="text-sm font-medium">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Bottom items */}
        <div className="space-y-1 border-t border-border/60 px-2 py-4">
          {!isCollapsed && user && (
            <div className="mb-2 flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                {(user.name || user.email || "?").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user.name || "Trader"}</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
            </div>
          )}

          {bottomItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              title={isCollapsed ? item.label : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground ${
                isCollapsed ? "justify-center" : ""
              }`}
              activeClassName="bg-primary/10 text-primary border border-primary/20"
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {!isCollapsed && <span className="text-sm font-medium">{item.label}</span>}
            </NavLink>
          ))}

          <button
            onClick={handleLogout}
            title={isCollapsed ? "Logout" : undefined}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive ${
              isCollapsed ? "justify-center" : ""
            }`}
          >
            <LogOut className="h-4 w-4 flex-shrink-0" />
            {!isCollapsed && <span className="text-sm font-medium">Logout</span>}
          </button>
        </div>
      </div>
    </aside>
  );
};

export default DashboardSidebar;
