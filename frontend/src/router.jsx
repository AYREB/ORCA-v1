import React from "react";
import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import ResultsLayout from "./pages/ResultsLayout";
import Results from "./pages/Results";
import Garch from "./pages/Garch";
import MonteCarlo from "./pages/MonteCarlo";

export default function RouterFile() {
  return (
    <Routes>
      {/* Home page, no nav */}
      <Route path="/" element={<Home />} />

      {/* Analysis pages with nav */}
      <Route path="/analysis" element={<ResultsLayout />}>
        <Route index element={<Results />} />        {/* default: Results */}
        <Route path="garch" element={<Garch />} />
        <Route path="montecarlo" element={<MonteCarlo />} />
      </Route>
    </Routes>
  );
}
