import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

interface AdminRouteProps {
  children: ReactNode;
}

/**
 * Gate for the admin analytics dashboard. Requires a signed-in **superuser**.
 * Non-superusers are bounced to the dashboard (the backend independently
 * enforces is_superuser on every /admin/* endpoint, so this is a UX gate, not
 * the security boundary).
 */
const AdminRoute = ({ children }: AdminRouteProps) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Checking access…</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" state={{ from: location.pathname }} replace />;
  }

  if (!user.is_superuser) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

export default AdminRoute;
