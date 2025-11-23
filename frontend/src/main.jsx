import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import RouterFile from "./router";
import "./styles.css";
import { ResultsProvider } from "./context/ResultsContext";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ResultsProvider>
      <BrowserRouter>
        <RouterFile />
      </BrowserRouter>
    </ResultsProvider>
  </React.StrictMode>
);

