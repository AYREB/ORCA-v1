import React, { useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Link } from "react-router-dom";
import { simulateGarch } from "../utils/garch";

export default function Garch() {
  const [omega, setOmega] = useState(0.000001);
  const [alpha, setAlpha] = useState(0.05);
  const [beta, setBeta] = useState(0.9);
  const [mu, setMu] = useState(0.001);
  const [horizon, setHorizon] = useState(50);
  const [sims, setSims] = useState(3);
  const [paths, setPaths] = useState([]);

  const run = () => {
    const p = simulateGarch({
      omega: Number(omega),
      alpha: Number(alpha),
      beta: Number(beta),
      mu: Number(mu),
      sim_horizon: Number(horizon),
      simulations: Number(sims)
    });
    setPaths(p);
  };

  const chartData = paths.map((path, i) =>
    path.map((v, idx) => ({ step: idx, [`Path ${i + 1}`]: v }))
  );

  // merge paths for recharts
  const mergedData = [];
  if (chartData.length) {
    for (let i = 0; i < chartData[0].length; i++) {
      const obj = { step: chartData[0][i].step };
      chartData.forEach((path, j) => (obj[`Path ${j + 1}`] = path[i][`Path ${j + 1}`]));
      mergedData.push(obj);
    }
  }

  return (
    <div className="app-root">
      <h2>GARCH Simulator</h2>
      <Link to="/" className="btn small">Home</Link>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label>omega ({omega})</label>
            <input type="range" min="0" max="0.01" step="0.000001" value={omega} onChange={(e) => setOmega(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div>
            <label>alpha ({alpha})</label>
            <input type="range" min="0" max="1" step="0.01" value={alpha} onChange={(e) => setAlpha(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div>
            <label>beta ({beta})</label>
            <input type="range" min="0" max="1" step="0.01" value={beta} onChange={(e) => setBeta(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div>
            <label>mu ({mu})</label>
            <input type="range" min="-0.01" max="0.01" step="0.0001" value={mu} onChange={(e) => setMu(e.target.value)} style={{ width: "100%" }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <div>
            <label>Horizon</label>
            <input type="number" value={horizon} onChange={(e) => setHorizon(e.target.value)} />
          </div>
          <div>
            <label>Simulations</label>
            <input type="number" value={sims} onChange={(e) => setSims(e.target.value)} />
          </div>
          <button className="btn" onClick={run}>Run</button>
        </div>

        {paths.length > 0 && (
          <LineChart width={600} height={300} data={mergedData} style={{ marginTop: 20 }}>
            <CartesianGrid stroke="#ccc" />
            <XAxis dataKey="step" />
            <YAxis />
            <Tooltip />
            {paths.map((_, i) => <Line key={i} type="monotone" dataKey={`Path ${i + 1}`} stroke={`hsl(${i * 60}, 70%, 50%)`} />)}
          </LineChart>
        )}
      </div>
    </div>
  );
}
