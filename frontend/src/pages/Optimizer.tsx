import { useState, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { motion } from "framer-motion";
import { Sliders, Bookmark, AlertCircle } from "lucide-react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import ParameterOptimizer from "@/components/backtest/ParameterOptimizer";
import SavedStrategies from "@/components/backtest/SavedStrategies";
import { api, SavedStrategy } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

const Optimizer = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<SavedStrategy | null>(null);
  const [strategies, setStrategies] = useState<SavedStrategy[]>([]);
  const { user } = useAuth();

  useEffect(() => {
    const loadStrategies = async () => {
      try {
        const data = await api.fetchStrategies();
        setStrategies(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load strategies";
        toast.error(message);
      }
    };

    if (user) {
      loadStrategies();
    }
  }, [user]);

  const handleSelectStrategy = (strategy: SavedStrategy) => {
    setSelectedStrategy(strategy);
  };

  const handleDeleteStrategy = async (id: number) => {
    try {
      await api.deleteStrategy(id);
      const data = await api.fetchStrategies();
      setStrategies(data);
      if (selectedStrategy?.id === id) {
        setSelectedStrategy(null);
      }
      toast.success("Strategy deleted");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete strategy";
      toast.error(message);
    }
  };

  return (
    <>
      <Helmet>
        <title>Parameter Optimizer - Orca</title>
        <meta name="description" content="Optimize your trading strategy parameters with grid search and auto-optimization." />
      </Helmet>

      <div className="min-h-screen bg-background">
        <DashboardSidebar
          isCollapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />

        <main className={`transition-all duration-300 ${sidebarCollapsed ? "ml-16" : "ml-64"}`}>
          <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
                  <Sliders className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">Parameter Optimizer</h1>
                  <p className="text-muted-foreground text-sm">
                    Select a saved strategy to optimize its parameters
                  </p>
                </div>
              </div>
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Strategy Selection */}
              <div className="lg:col-span-1">
                <SavedStrategies
                  strategies={strategies}
                  onSelect={handleSelectStrategy}
                  onDelete={handleDeleteStrategy}
                  selectedId={selectedStrategy?.id || null}
                />
              </div>

              {/* Optimizer Panel */}
              <div className="lg:col-span-2">
                {selectedStrategy ? (
                  <motion.div
                    key={selectedStrategy.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <div className="mb-4 p-4 rounded-xl border border-primary/30 bg-primary/5">
                      <div className="flex items-center gap-2 mb-2">
                        <Bookmark className="h-4 w-4 text-primary" />
                        <span className="font-semibold">{selectedStrategy.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Created {new Date(selectedStrategy.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <ParameterOptimizer dslJson={selectedStrategy.dslJson || null} />
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col items-center justify-center h-[500px] rounded-xl border border-dashed border-border bg-card/30"
                  >
                    <div className="p-4 rounded-full bg-muted/30 mb-4">
                      <AlertCircle className="h-12 w-12 text-muted-foreground/50" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2">No Strategy Selected</h3>
                    <p className="text-muted-foreground text-center max-w-md mb-4">
                      Select a saved strategy from the list to optimize its parameters.
                      Run a backtest first to save strategies.
                    </p>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Bookmark className="h-4 w-4" />
                      <span>{strategies.length} strategies available</span>
                    </div>
                  </motion.div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
};

export default Optimizer;
