import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import Backtest from "./pages/Backtest";
import Optimizer from "./pages/Optimizer";
import Genetic from "./pages/Genetic";
import NotFound from "./pages/NotFound";
import Strategies from "./pages/Strategies";
import CustomIndicators from "./pages/CustomIndicators";
import CustomIndicatorDocs from "./pages/CustomIndicatorDocs";
import PaperAccounts from "./pages/PaperAccounts";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import Help from "./pages/Help"
import { AuthProvider } from "./context/AuthContext";
import { SettingsProvider } from "./hooks/useSettings";
import Settings from "./pages/Settings";

const queryClient = new QueryClient();

const App = () => (
  <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SettingsProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <Routes>
                <Route path="/" element={<Index />} />
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
                  path="/dashboard/optimizer"
                  element={
                    <ProtectedRoute>
                      <Optimizer />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/genetic"
                  element={
                    <ProtectedRoute>
                      <Genetic />
                    </ProtectedRoute>
                  }
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
                <Route path="/dashboard/help" element={<Help />} />
                <Route path="*" element={<NotFound />} />
                <Route path="/dashboard/settings" element={<Settings />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </SettingsProvider>
      </AuthProvider>
    </QueryClientProvider>
  </HelmetProvider>
);

export default App;
