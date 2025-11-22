import React from "react";

export default function SummaryCard({ cash, invested, total, pct }) {
  const n = (v) => (typeof v === "number" ? v.toFixed(2) : v);
  return (
    <div style={{ padding: 12, background: "#fbfdff", borderRadius: 8 }}>
      <div><strong>Cash:</strong> {n(cash)}</div>
      <div><strong>Invested:</strong> {n(invested)}</div>
      <div><strong>Total:</strong> {n(total)}</div>
      <div><strong>% change:</strong> {typeof pct === "number" ? `${pct.toFixed(2)}%` : pct}</div>
    </div>
  );
}
