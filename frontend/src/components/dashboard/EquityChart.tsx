import { motion } from "framer-motion";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const data = [
  { date: "Jan", equity: 10000 },
  { date: "Feb", equity: 10800 },
  { date: "Mar", equity: 10400 },
  { date: "Apr", equity: 11500 },
  { date: "May", equity: 11200 },
  { date: "Jun", equity: 12800 },
  { date: "Jul", equity: 13500 },
  { date: "Aug", equity: 13100 },
  { date: "Sep", equity: 14200 },
  { date: "Oct", equity: 15100 },
  { date: "Nov", equity: 14600 },
  { date: "Dec", equity: 16200 },
];

const EquityChart = () => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold">Equity Curve</h3>
          <p className="text-sm text-muted-foreground">Portfolio performance over time</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-primary" />
            <span className="text-sm text-muted-foreground">Equity</span>
          </div>
        </div>
      </div>

      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(175, 80%, 50%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(175, 80%, 50%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 30%, 18%)" />
            <XAxis
              dataKey="date"
              stroke="hsl(215, 20%, 55%)"
              tick={{ fill: "hsl(215, 20%, 55%)", fontSize: 12 }}
              axisLine={{ stroke: "hsl(222, 30%, 18%)" }}
            />
            <YAxis
              stroke="hsl(215, 20%, 55%)"
              tick={{ fill: "hsl(215, 20%, 55%)", fontSize: 12 }}
              axisLine={{ stroke: "hsl(222, 30%, 18%)" }}
              tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(222, 47%, 8%)",
                border: "1px solid hsl(222, 30%, 18%)",
                borderRadius: "8px",
                fontSize: 12,
              }}
              labelStyle={{ color: "hsl(210, 40%, 98%)" }}
              formatter={(value: number) => [`$${value.toLocaleString()}`, "Equity"]}
            />
            <Area
              type="monotone"
              dataKey="equity"
              stroke="hsl(175, 80%, 50%)"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorEquity)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
};

export default EquityChart;
