import React, { createContext, useContext, useState, ReactNode } from "react";
import { BacktestResult } from "@/lib/api";

interface BacktestContextType {
  results: BacktestResult | null;
  setResults: (results: BacktestResult | null) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  error: string | null;
  setError: (error: string | null) => void;
}

const BacktestContext = createContext<BacktestContextType | undefined>(undefined);

export const BacktestProvider = ({ children }: { children: ReactNode }) => {
  const [results, setResults] = useState<BacktestResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <BacktestContext.Provider
      value={{
        results,
        setResults,
        isLoading,
        setIsLoading,
        error,
        setError,
      }}
    >
      {children}
    </BacktestContext.Provider>
  );
};

export const useBacktest = () => {
  const context = useContext(BacktestContext);
  if (!context) {
    throw new Error("useBacktest must be used within a BacktestProvider");
  }
  return context;
};
