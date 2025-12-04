import React, { useContext, useState, useEffect } from "react";
import { ResultsContext } from "../context/ResultsContext";
import API from "../api";

function extractOptimizableParameters(node, path = "", parentIndicator = null) {
  let params = {};
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      Object.assign(
        params,
        extractOptimizableParameters(item, `${path}[${i}]`, parentIndicator)
      );
    });
  } else if (typeof node === "object" && node !== null) {
    let currentIndicator = parentIndicator;

    if (node.func) {
      currentIndicator = node.func;
    }

    Object.entries(node).forEach(([key, value]) => {
      const newPath = path ? `${path}.${key}` : key;

      if (typeof value === "number" && /period|percent|threshold|amount/i.test(key)) {
        params[newPath] = { value, indicator: currentIndicator };
      }

      Object.assign(params, extractOptimizableParameters(value, newPath, currentIndicator));
    });
  }
  return params;
}

export default function ParameterOptimiser() {
  const { results } = useContext(ResultsContext);
  const dsl = results?.json_dsl;

  const [paramChoices, setParamChoices] = useState({});
  const [initialBalance, setInitialBalance] = useState(10000);
  const [optimizerResult, setOptimizerResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (dsl) {
        const params = extractOptimizableParameters(dsl);
        const initialChoices = {};
        Object.entries(params).forEach(([param, info]) => {
        initialChoices[param] = { mode: "nochange" }; // default is no change
        });
        setParamChoices(initialChoices);
    }
    }, [dsl]);

  const handleModeChange = (param, mode) => {
    setParamChoices((prev) => {
        const updated = { ...prev };
        if (mode === "manual") {
        updated[param] = { mode, values: [0] }; // start with one value
        } else if (mode === "range") {
        updated[param] = { mode, start: 0, end: 1, steps: 4 }; // default range
        } else if (mode === "auto") {
        updated[param] = { mode: "auto" }; // explicit auto
        } else if (mode === "nochange") {
        updated[param] = { mode: "nochange" }; // keep nochange in state (optional)
        }
        return updated;
    });
    };




  const handleValueChange = (param, index, value) => {
    setParamChoices((prev) => {
      const newValues = [...(prev[param].values || [])];
      newValues[index] = Number(value);
      return { ...prev, [param]: { ...prev[param], values: newValues } };
    });
  };

  const handleRangeChange = (param, field, value) => {
    setParamChoices((prev) => ({
      ...prev,
      [param]: { ...prev[param], [field]: Number(value) },
    }));
  };

  const submitOptimizer = async () => {
    setLoading(true);
    setError(null);
    setOptimizerResult(null);

    try {
        const payload = {};
        Object.entries(paramChoices).forEach(([param, choice]) => {
        if (choice.mode !== "nochange") payload[param] = choice;
        });

        const res = await API.post("/api/dslParameterOptimiser/", {
        dsl_json: dsl,
        parameter_choice: payload,
        initial_balance: initialBalance,
        });

        setOptimizerResult(res.data);
    } catch (err) {
        if (err.response?.data?.error) {
        setError(err.response.data.error);
        } else {
        setError(err.message || "Optimizer request failed");
        }
    } finally {
        setLoading(false);
    }
    };


  const addManualValue = (param) => {
    setParamChoices((prev) => {
        const current = prev[param] || { mode: "manual", values: [] };
        return {
        ...prev,
        [param]: { ...current, values: [...current.values, 0] }, // default 0
        };
    });
    };

  const removeManualValue = (param, index) => {
    setParamChoices((prev) => {
        const current = prev[param];
        if (!current) return prev;
        const newValues = [...current.values];
        newValues.splice(index, 1);
        return {
        ...prev,
        [param]: { ...current, values: newValues },
        };
    });
    };





  return (
    <div>
      <h2>Optimizable Parameters</h2>

      <div style={{ marginBottom: "1rem" }}>
        Initial Balance:{" "}
        <input
          type="number"
          value={initialBalance}
          onChange={(e) => setInitialBalance(Number(e.target.value))}
          style={{ width: "7rem" }}
        />
      </div>

      {dsl &&
        Object.entries(paramChoices).map(([param, choice]) => (
          <div
            key={param}
            style={{ marginBottom: "1rem", border: "1px solid #ccc", padding: "0.5rem" }}
          >
            <strong>{param}</strong>
            {choice.indicator && (
              <span style={{ marginLeft: "0.5rem", fontStyle: "italic", color: "#555" }}>
                ({choice.indicator})
              </span>
            )}
            <div>
              Mode:{" "}
              <select
                value={choice.mode || "nochange"}
                onChange={(e) => handleModeChange(param, e.target.value)}
                >
                <option value="nochange">No Change</option>
                <option value="auto">Auto</option>   {/* explicit auto */}
                <option value="manual">Manual</option>
                <option value="range">Range</option>
              </select>
            </div>

            {choice.mode === "manual" &&
                choice.values.map((val, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    Value {i + 1}:{" "}
                    <input
                        type="number"
                        value={val}
                        onChange={(e) => handleValueChange(param, i, e.target.value)}
                        style={{ width: "5rem" }}
                    />
                    <button type="button" onClick={() => removeManualValue(param, i)}>-</button>
                    </div>
                ))}
                {choice.mode === "manual" && (
                <button type="button" onClick={() => addManualValue(param)}>
                    + Add Value
                </button>
            )}

            {choice.mode === "range" && (
              <div>
                Start:{" "}
                <input
                  type="number"
                  value={choice.start}
                  onChange={(e) => handleRangeChange(param, "start", e.target.value)}
                />
                End:{" "}
                <input
                  type="number"
                  value={choice.end}
                  onChange={(e) => handleRangeChange(param, "end", e.target.value)}
                />
                Steps:{" "}
                <input
                  type="number"
                  value={choice.steps}
                  onChange={(e) => handleRangeChange(param, "steps", e.target.value)}
                />
              </div>
            )}
          </div>
        ))}

      <button onClick={submitOptimizer} disabled={loading}>
        {loading ? "Running Optimizer..." : "Run Optimizer"}
      </button>

      {error && <div style={{ color: "red", marginTop: "1rem" }}>Error: {error}</div>}

      {optimizerResult && (
        <div style={{ marginTop: "2rem" }}>
            <h3>Best Result</h3>

            <div>
            <strong>Optimized Parameters:</strong>
            <pre>
                {JSON.stringify(
                Object.fromEntries(
                    Object.entries(optimizerResult.best_result.params).filter(
                    ([_, val]) => val !== undefined && val !== null
                    )
                ),
                null,
                2
                )}
            </pre>
            </div>

            <div>
            <strong>Metrics:</strong>
            <pre>{JSON.stringify(optimizerResult.best_result.results, null, 2)}</pre>
            </div>
        </div>
        )}

    </div>
  );
}
