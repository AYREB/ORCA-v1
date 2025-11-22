import React from "react";

export default function TradesTable({ trades = [] }) {
  if (!trades.length) return <div className="small">No trades</div>;
  return (
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Ticker</th>
          <th>Price</th>
          <th>Shares</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t, i) => (
          <tr key={i}>
            <td>{t.type}</td>
            <td>{t.ticker}</td>
            <td>{t.price?.toFixed ? t.price.toFixed(2) : t.price}</td>
            <td>{t.shares}</td>
            <td>{new Date(t.timestamp).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
