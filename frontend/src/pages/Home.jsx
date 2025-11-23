import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../api";
import { useContext } from "react";
import { ResultsContext } from "../context/ResultsContext";


export default function Home() {
  const [dsl, setDsl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const { setResults } = useContext(ResultsContext);

  const runDsl = async () => {
    if (!dsl.trim()) {
        setError("Enter a DSL command.");
        return;
    }
    setError("");
    setLoading(true);

    try {
        const res = await API.post("/api/backtest/", { dsl });
        
        setResults(res.data);        // <-- save globally
        navigate("/analysis");       // no need to include state
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
            onClick={() => setDsl(":TICKER(AAPL,TSLA,MSFT) :EXECUTION_TIMEFRAME(1h) :DATA_TIMEFRAMES(1h,4h) :DATEFRAME(2024-01-01, 2025-11-01) :LONG(    OPEN{        CONDITIONS{            RSI() < 30        }        |ARGUMENTS{            initialOpenPositionInvestType = percentCashBalance            |initialOpenPositionInvestAmount = 0.1            |recurring=false            |stopLossPercent =6            |takeProfitPercent = 10        }    }    |CLOSE{         CONDITIONS{             RSI(offset=1) > 75         }    } )")}
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
