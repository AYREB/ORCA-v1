import React from "react";
import { Outlet, Link } from "react-router-dom";

export default function App() {
  return (
    <div className="app-root">
      <nav style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <Link to="/" className="small">Home</Link>
        <Link to="/garch" className="small">GARCH</Link>
        <Link to="/montecarlo" className="small">Monte Carlo</Link>
      </nav>

      <Outlet />
    </div>
  );
}
