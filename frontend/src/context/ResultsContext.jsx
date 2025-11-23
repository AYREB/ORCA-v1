import { createContext, useContext, useState } from "react";

export const ResultsContext = createContext(null);

export function ResultsProvider({ children }) {
  const [results, setResults] = useState(null);

  return (
    <ResultsContext.Provider value={{ results, setResults }}>
      {children}
    </ResultsContext.Provider>
  );
}

export function useResults() {
  return useContext(ResultsContext);
}
