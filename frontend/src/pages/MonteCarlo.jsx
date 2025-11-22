import React, { useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Link } from "react-router-dom";
import { simulateMC } from "../utils/montecarlo";

export default function MonteCarlo() {
  const [s0, setS0] = useState(100);
  const [mu, setMu] = useState(0.05);
  const [sigma, setSigma] = useState(0.2);
  const [steps, setSteps] = useState(252);
  const [sims, setSims] = useState(10);
  const [paths, setPaths] = useState([]);

  const run = () => {
    const p = simulateMC(Number(s0), Number(mu), Number(sigma), Number(steps), Number(sims));
    setPaths(p);
  };

  // merge paths for recharts
  const mergedData = [];
  if (paths.length) {
    for (let i = 0; i < paths[0].length; i++) {
      const obj = { step: i };
      paths.forEach((p, j) => (obj[`Path ${j + 1}`] = p[i]));
      mergedData.push(obj);
    }
  }

  return (
    <div className="app-root">
      <h2>Monte Carlo - GBM</h2>
      <Link to="/" className="btn small">Home</Link>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
          <div><label>S0</label><input type="number" value={s0} onChange={(e) => setS0(e.target.value)} /></div>
          <div><label>mu</label><input type="number" step="0.01" value={mu} onChange={(e) => setMu(e.target.value)} /></div>
          <div><label>sigma</label><input type="number" step="0.01" value={sigma} onChange={(e) => setSigma(e.target.value)} /></div>
          <div><label>steps</label><input type="number" value={steps} onChange={(e) => setSteps(e.target.value)} /></div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn" onClick={run}>Run Monte Carlo</button>
          <div>
            <label className="small">Simulations</label>
            <input type="number" value={sims} onChange={(e) => setSims(e.target.value)} style={{ width: 100 }} />
          </div>
        </div>

        {paths.length > 0 && (
          <LineChart width={600} height={300} data={mergedData} style={{ marginTop: 20 }}>
            <CartesianGrid stroke="#ccc" />
            <XAxis dataKey="step" />
            <YAxis />
            <Tooltip />
            {paths.map((_, i) => <Line key={i} type="monotone" dataKey={`Path ${i + 1}`} stroke={`hsl(${i * 36}, 70%, 50%)`} />)}
          </LineChart>
        )}
      </div>
    </div>
  );
}
