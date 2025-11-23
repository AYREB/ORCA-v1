import React, { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import SummaryCard from "../components/SummaryCard";
import TradesTable from "../components/TradesTable";
import CandleChart from "../components/CandleChart";
import { useContext } from "react";
import { ResultsContext } from "../context/ResultsContext";

export default function Results() {
  const { results: result } = useContext(ResultsContext);

  const tradesAll = result.trades || [];
  const data = result.data || {};

  const tickers = Object.keys(data);

  const [selectedTicker, setSelectedTicker] = useState(tickers[0] || null);

  const timeframes = selectedTicker ? Object.keys(data[selectedTicker]) : [];

  const [selectedTf, setSelectedTf] = useState(timeframes[0] || null);

  const candles =
    selectedTicker && selectedTf ? data[selectedTicker][selectedTf] : [];

  // Filter trades for selected ticker
  const trades = tradesAll.filter((t) => t.ticker === selectedTicker);

  const [showTrades, setShowTrades] = useState(true);

  const stats = useMemo(
    () => ({
      cash: result.cash ?? "-",
      invested: result.invested ?? "-",
      total: result.total_portfolio ?? "-",
      pct: result.pct_change ?? "-",
    }),
    [result]
  );

  // update timeframe dropdown when ticker changes
  const handleTickerChange = (e) => {
    const newTicker = e.target.value;
    setSelectedTicker(newTicker);
    const newTfs = Object.keys(data[newTicker]);
    setSelectedTf(newTfs[0]); // auto-select first available timeframe
  };

  return (
    <div className="app-root">
      <h2>Backtest results</h2>

      {/* ---------------- Dropdowns ---------------- */}
      <div style={{ marginTop: 12, marginBottom: 12, display: "flex", gap: 12 }}>
        {/* Ticker select */}
        <select
          value={selectedTicker}
          onChange={handleTickerChange}
          style={{ padding: 6 }}
        >
          {tickers.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        {/* Timeframe select */}
        <select
          value={selectedTf}
          onChange={(e) => setSelectedTf(e.target.value)}
          style={{ padding: 6 }}
        >
          {timeframes.map((tf) => (
            <option key={tf} value={tf}>
              {tf}
            </option>
          ))}
        </select>
      </div>

      {/* ---------------- Layout ---------------- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          gap: 12,
          marginTop: 12,
        }}
      >
        <div className="card">
          <h3>Summary</h3>
          <SummaryCard
            cash={stats.cash}
            invested={stats.invested}
            total={stats.total}
            pct={stats.pct}
          />
          <hr />

          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginTop: 8,
            }}
          >
            <label className="small">Show trades</label>
            <input
              type="checkbox"
              checked={showTrades}
              onChange={(e) => setShowTrades(e.target.checked)}
            />
          </div>

          <h4 style={{ marginTop: 12 }}>Trades — {selectedTicker}</h4>
          <div style={{ maxHeight: 320, overflow: "auto" }}>
            <TradesTable trades={trades} />
          </div>
        </div>

        <div>
          <CandleChart
            candles={candles}
            trades={trades}
            showTrades={showTrades}
          />
        </div>
      </div>
    </div>
  );
}
