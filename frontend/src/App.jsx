import React, { useState } from "react";


export default function App() {
  const [dsl, setDsl] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);

  const runDsl = async () => {
    if (!dsl.trim()) {
      setOutput("Please enter a DSL command.");
      return;
    }

    setLoading(true);
    setOutput("");

    try {
      const response = await fetch("http://localhost:8000/api/backtest/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dsl }),
      });

      const data = await response.json();
      setOutput(data.message || "No message returned.");
    } catch (err) {
      setOutput("Error connecting to backend.");
    }

    setLoading(false);
  };

  return (
    <div style={{ padding: 40, fontFamily: "Arial", maxWidth: 800, margin: "0 auto" }}>
      <h1>ORCA Trading DSL Runner</h1>

      <label style={{ fontWeight: "bold" }}>Enter DSL command:</label>
      <textarea
        value={dsl}
        onChange={(e) => setDsl(e.target.value)}
        placeholder="e.g., BUY BTC WHEN SMA(20) CROSSES SMA(50)"
        rows={6}
        style={{
          width: "100%",
          padding: 12,
          marginTop: 8,
          marginBottom: 20,
          fontSize: 16,
          borderRadius: 6,
          border: "1px solid #ccc",
        }}
      />

      <button
        onClick={runDsl}
        disabled={loading}
        style={{
          padding: "12px 24px",
          fontSize: 16,
          background: "#4a8cff",
          color: "white",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        {loading ? "Running..." : "Run DSL"}
      </button>

      {output && (
        <div
          style={{
            marginTop: 30,
            padding: 20,
            background: "#f4f4f4",
            borderRadius: 6,
            fontSize: 16,
          }}
        >
          <strong>Result:</strong>
          <div style={{ marginTop: 10 }}>{output}</div>
        </div>
      )}
    </div>
  );
}
