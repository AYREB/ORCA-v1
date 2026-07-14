import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import Backtest from "./pages/Backtest";
import Optimizers from "./pages/Optimizers";
import NotFound from "./pages/NotFound";
import Strategies from "./pages/Strategies";
import CustomIndicators from "./pages/CustomIndicators";
import CustomIndicatorDocs from "./pages/CustomIndicatorDocs";
import PaperAccounts from "./pages/PaperAccounts";
import History from "./pages/History";
import Charts from "./pages/Charts";
import Legal from "./pages/Legal";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import AdminRoute from "./components/auth/AdminRoute";
import AdminDashboard from "./pages/AdminDashboard";
import Help from "./pages/Help"
import { AuthProvider } from "./context/AuthContext";
import { SettingsProvider } from "./hooks/useSettings";
import { RegistryProvider } from "@/context/RegistryContext";
import Settings from "./pages/Settings";
import Plans from "./pages/Plans";
import ResetPassword from "./pages/ResetPassword";
import VerifyEmail from "./pages/VerifyEmail";
import PlanLimitDialog from "./components/plan/PlanLimitDialog";

const queryClient = new QueryClient();

const App = () => (
  <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SettingsProvider>
          <RegistryProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <PlanLimitDialog />
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/verify-email" element={<VerifyEmail />} />
                  <Route path="/legal/:doc" element={<Legal />} />
                  <Route
                    path="/dashboard"
                    element={
                      <ProtectedRoute>
                        <Dashboard />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/dashboard/backtest"
                    element={
                      <ProtectedRoute>
                        <Backtest />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/dashboard/optimizers"
                    element={
                      <ProtectedRoute>
                        <Optimizers />
                      </ProtectedRoute>
                    }
                  />
                  {/* Legacy routes -> unified Optimizers tab */}
                  <Route
                    path="/dashboard/optimizer"
                    element={<Navigate to="/dashboard/optimizers?method=parameter" replace />}
                  />
                  <Route
                    path="/dashboard/genetic"
                    element={<Navigate to="/dashboard/optimizers?method=genetic" replace />}
                  />
                  <Route
                    path="/dashboard/strategies"
                    element={
                      <ProtectedRoute>
                        <Strategies />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/dashboard/indicators"
                    element={
                      <ProtectedRoute>
                        <CustomIndicators />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/dashboard/indicators/docs"
                    element={
                      <ProtectedRoute>
                        <CustomIndicatorDocs />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/dashboard/paper-accounts"
                    element={
                      <ProtectedRoute>
                        <PaperAccounts />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/dashboard/charts"
                    element={
                      <ProtectedRoute>
                        <Charts />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/dashboard/history"
                    element={
                      <ProtectedRoute>
                        <History />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/dashboard/help"
                    element={
                      <ProtectedRoute>
                        <Help />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/dashboard/settings"
                    element={
                      <ProtectedRoute>
                        <Settings />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/dashboard/plans"
                    element={
                      <ProtectedRoute>
                        <Plans />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/dashboard/admin"
                    element={
                      <AdminRoute>
                        <AdminDashboard />
                      </AdminRoute>
                    }
                  />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </BrowserRouter>
            </TooltipProvider>
          </RegistryProvider>
        </SettingsProvider>
      </AuthProvider>
    </QueryClientProvider>
  </HelmetProvider>
);

export default App;
