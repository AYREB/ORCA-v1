import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../api";

export default function Home() {
  const [dsl, setDsl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const runDsl = async () => {
    if (!dsl.trim()) {
      setError("Enter a DSL command.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await API.post("/api/backtest/", { dsl });
      navigate("/analysis", { state: res.data }); // pass data to analysis
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.detail || "Error connecting to backend");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-root">
      <h1>ORCA</h1>
      <div className="card">
        <label className="small" style={{ fontWeight: 700 }}>Enter DSL</label>
        <textarea
          value={dsl}
          onChange={(e) => setDsl(e.target.value)}
          rows={6}
          placeholder="e.g. BUY AAPL WHEN SMA(20) CROSSES SMA(50)"
          style={{ width: "100%", marginTop: 8 }}
        />
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button className="btn" onClick={runDsl} disabled={loading}>
            {loading ? "Running..." : "Run DSL"}
          </button>
          <button
            className="btn"
            onClick={() => setDsl("BUY AAPL WHEN SMA(20) CROSSES SMA(50)")}
            style={{ background: "#10b981" }}
          >
            Example
          </button>
        </div>
        {error && <div style={{ marginTop: 12, color: "crimson" }}>{error}</div>}
      </div>
    </div>
  );
}
