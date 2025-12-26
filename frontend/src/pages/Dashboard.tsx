import { useState } from "react";
import { motion } from "framer-motion";
import { Helmet } from "react-helmet-async";
import { FlaskConical, TrendingUp, BarChart3, Activity } from "lucide-react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import StatCard from "@/components/dashboard/StatCard";
import EquityChart from "@/components/dashboard/EquityChart";
import RecentBacktests from "@/components/dashboard/RecentBacktests";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const Dashboard = () => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const navigate = useNavigate();

  return (
    <>
      <Helmet>
        <title>Dashboard - Orca</title>
        <meta name="description" content="View your trading strategy performance and recent backtests." />
      </Helmet>

      <div className="min-h-screen bg-background">
        <DashboardSidebar
          isCollapsed={isSidebarCollapsed}
          onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        />

        <main
          className={`transition-all duration-300 ${
            isSidebarCollapsed ? "ml-16" : "ml-64"
          }`}
        >
          <div className="p-8">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="flex items-center justify-between mb-8"
            >
              <div>
                <h1 className="text-3xl font-bold">Dashboard</h1>
                <p className="text-muted-foreground">Welcome back! Here's your trading overview.</p>
              </div>
              <Button variant="hero" onClick={() => navigate("/dashboard/backtest")}>
                <FlaskConical className="h-5 w-5" />
                New Backtest
              </Button>
            </motion.div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <StatCard
                icon={TrendingUp}
                label="Total Return (YTD)"
                value="+63.4%"
                change="+12.3%"
                changeType="positive"
                delay={0}
              />
              <StatCard
                icon={BarChart3}
                label="Backtests Run"
                value="142"
                change="+8 this week"
                changeType="neutral"
                delay={0.1}
              />
              <StatCard
                icon={Activity}
                label="Win Rate"
                value="67.3%"
                change="+2.1%"
                changeType="positive"
                delay={0.15}
              />
              <StatCard
                icon={FlaskConical}
                label="Active Strategies"
                value="12"
                change="3 optimizing"
                changeType="neutral"
                delay={0.2}
              />
            </div>

            {/* Charts and Recent */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <EquityChart />
              <RecentBacktests />
            </div>
          </div>
        </main>
      </div>
    </>
  );
};

export default Dashboard;
