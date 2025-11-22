import React, { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import SummaryCard from "../components/SummaryCard";
import TradesTable from "../components/TradesTable";
import CandleChart from "../components/CandleChart";

export default function Results() {
  const location = useLocation();
  const result = location.state || {};
  const trades = result.trades || [];
  const data = result.data || {};
  const firstTicker = Object.keys(data)[0] || null;
  const firstTf = firstTicker ? Object.keys(data[firstTicker])[0] : null;
  const candles = firstTicker && firstTf ? data[firstTicker][firstTf] : [];

  const [showTrades, setShowTrades] = useState(true);

  const stats = useMemo(
    () => ({
      cash: result.cash ?? "-",
      invested: result.invested ?? "-",
      total: result.total_portfolio ?? "-",
      pct: result.pct_change ?? "-"
    }),
    [result]
  );

  return (
    <div className="app-root">
      <h2>Backtest results</h2>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 12, marginTop: 12 }}>
        <div className="card">
          <h3>Summary</h3>
          <SummaryCard cash={stats.cash} invested={stats.invested} total={stats.total} pct={stats.pct} />
          <hr />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <label className="small">Show trades</label>
            <input type="checkbox" checked={showTrades} onChange={(e) => setShowTrades(e.target.checked)} />
          </div>

          <h4 style={{ marginTop: 12 }}>Trades</h4>
          <div style={{ maxHeight: 320, overflow: "auto" }}>
            <TradesTable trades={trades} />
          </div>
        </div>

        <div>
          <CandleChart candles={candles} trades={trades} showTrades={showTrades} />
        </div>
      </div>
    </div>
  );
}
