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
import PaperAccounts from "./pages/PaperAccounts";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import Help from "./pages/Help"
import { AuthProvider } from "./context/AuthContext";
import Settings from "./pages/Settings";

const queryClient = new QueryClient();

const App = () => (
  <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
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
      </AuthProvider>
    </QueryClientProvider>
  </HelmetProvider>
);

export default App;
