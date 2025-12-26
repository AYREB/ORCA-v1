import { motion } from "framer-motion";
import { Activity, TrendingUp, AlertTriangle, BarChart3 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from "recharts";

const volatilityData = [
  { date: "Jan", actual: 0.018, predicted: 0.017, conditional: 0.016 },
  { date: "Feb", actual: 0.024, predicted: 0.022, conditional: 0.021 },
  { date: "Mar", actual: 0.032, predicted: 0.028, conditional: 0.027 },
  { date: "Apr", actual: 0.019, predicted: 0.021, conditional: 0.020 },
  { date: "May", actual: 0.015, predicted: 0.016, conditional: 0.015 },
  { date: "Jun", actual: 0.022, predicted: 0.020, conditional: 0.019 },
  { date: "Jul", actual: 0.028, predicted: 0.025, conditional: 0.024 },
  { date: "Aug", actual: 0.035, predicted: 0.030, conditional: 0.029 },
  { date: "Sep", actual: 0.021, predicted: 0.024, conditional: 0.023 },
  { date: "Oct", actual: 0.016, predicted: 0.018, conditional: 0.017 },
  { date: "Nov", actual: 0.014, predicted: 0.015, conditional: 0.014 },
  { date: "Dec", actual: 0.012, predicted: 0.013, conditional: 0.012 },
];

const garchMetrics = [
  { icon: Activity, label: "Omega (ω)", value: "0.000021", description: "Long-run variance" },
  { icon: TrendingUp, label: "Alpha (α)", value: "0.0842", description: "ARCH coefficient" },
  { icon: BarChart3, label: "Beta (β)", value: "0.9012", description: "GARCH coefficient" },
  { icon: AlertTriangle, label: "Persistence", value: "0.9854", description: "α + β" },
];

const GarchAnalysis = () => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      {/* GARCH Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
          <Activity className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">GARCH(1,1) Analysis</h3>
          <p className="text-sm text-muted-foreground">Volatility modeling and forecasting</p>
        </div>
      </div>

      {/* GARCH Parameters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {garchMetrics.map((metric, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: index * 0.05 }}
            className="p-4 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
          >
            <div className="flex items-center gap-2 mb-2">
              <metric.icon className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">{metric.label}</span>
            </div>
            <p className="text-xl font-bold font-mono text-foreground">{metric.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{metric.description}</p>
          </motion.div>
        ))}
      </div>

      {/* Volatility Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Conditional Volatility */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
        >
          <h4 className="text-md font-semibold mb-4">Conditional Volatility</h4>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={volatilityData}>
                <defs>
                  <linearGradient id="garchVol" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  tickFormatter={(value) => `${(value * 100).toFixed(1)}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number) => [`${(value * 100).toFixed(2)}%`, "σ²"]}
                />
                <Area
                  type="monotone"
                  dataKey="conditional"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#garchVol)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Actual vs Predicted */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
        >
          <h4 className="text-md font-semibold mb-4">Actual vs Predicted Volatility</h4>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={volatilityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  tickFormatter={(value) => `${(value * 100).toFixed(1)}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number) => [`${(value * 100).toFixed(2)}%`]}
                />
                <Line
                  type="monotone"
                  dataKey="actual"
                  stroke="hsl(var(--success))"
                  strokeWidth={2}
                  dot={false}
                  name="Actual"
                />
                <Line
                  type="monotone"
                  dataKey="predicted"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  name="Predicted"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-6 mt-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 bg-success" />
              <span className="text-xs text-muted-foreground">Actual</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 bg-primary border-dashed" />
              <span className="text-xs text-muted-foreground">Predicted</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Model Diagnostics */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
        className="p-4 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
      >
        <h4 className="text-md font-semibold mb-3">Model Diagnostics</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Log-Likelihood:</span>
            <span className="ml-2 font-mono text-foreground">4,218.34</span>
          </div>
          <div>
            <span className="text-muted-foreground">AIC:</span>
            <span className="ml-2 font-mono text-foreground">-8,428.68</span>
          </div>
          <div>
            <span className="text-muted-foreground">BIC:</span>
            <span className="ml-2 font-mono text-foreground">-8,402.15</span>
          </div>
          <div>
            <span className="text-muted-foreground">Ljung-Box p-value:</span>
            <span className="ml-2 font-mono text-success">0.342</span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default GarchAnalysis;
