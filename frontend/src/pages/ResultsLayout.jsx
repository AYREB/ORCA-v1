import React from "react";
import { Outlet, Link } from "react-router-dom";

export default function ResultsLayout() {
  return (
    <div className="app-root">
      <nav style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <Link to="/analysis" className="small btn">Analysis</Link>
        <Link to="/analysis/garch" className="small btn">GARCH</Link>
        <Link to="/analysis/montecarlo" className="small btn">Monte Carlo</Link>
        <Link to="/analysis/parameteroptimizer" className="small btn">Optimizer</Link>
        <Link to="/" className="small btn">New DSL</Link>
      </nav>
      <Outlet />
    </div>
  );
}
