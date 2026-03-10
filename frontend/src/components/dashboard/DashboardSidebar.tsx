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
  Dna
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
  { icon: Sliders, label: "Optimizer", path: "/dashboard/optimizer" },
  { icon: Dna, label: "Genetic", path: "/dashboard/genetic" },
  { icon: LineChart, label: "Strategies", path: "/dashboard/strategies" },
  { icon: History, label: "History", path: "/dashboard/history" },
];

const bottomItems = [
  { icon: Settings, label: "Settings", path: "/dashboard/settings" },
  { icon: HelpCircle, label: "Help", path: "/dashboard/help" },
];

const DashboardSidebar = ({ isCollapsed, onToggle }: DashboardSidebarProps) => {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <aside
      className={`fixed left-0 top-0 h-screen border-r border-border bg-card/50 backdrop-blur-xl transition-all duration-300 z-40 ${
        isCollapsed ? "w-16" : "w-64"
      }`}
    >
      <div className="flex flex-col h-full">
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-border">
          {!isCollapsed && (
            <div className="flex items-center gap-2">
              <img src={orcaLogo} alt="Orca Logo" className="h-8 w-8 rounded-lg" />
              <span className="text-lg font-bold">Orca</span>
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
        <nav className="flex-1 py-4 px-2 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/dashboard"}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors ${
                isCollapsed ? "justify-center" : ""
              }`}
              activeClassName="bg-primary/10 text-primary border border-primary/20"
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {!isCollapsed && <span className="font-medium">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Bottom items */}
        <div className="py-4 px-2 space-y-1 border-t border-border">
          {bottomItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors ${
                isCollapsed ? "justify-center" : ""
              }`}
              activeClassName="bg-primary/10 text-primary"
            >
              <item.icon className="h-5 w-5 flex-shrink-0" />
              {!isCollapsed && <span className="font-medium">{item.label}</span>}
            </NavLink>
          ))}
          
          <button
            onClick={handleLogout}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors ${
              isCollapsed ? "justify-center" : ""
            }`}
          >
            <LogOut className="h-5 w-5 flex-shrink-0" />
            {!isCollapsed && <span className="font-medium">Logout</span>}
          </button>
        </div>
      </div>
    </aside>
  );
};

export default DashboardSidebar;
