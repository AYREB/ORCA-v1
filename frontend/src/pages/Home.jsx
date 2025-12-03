import React, { useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import API from "../api";
import { ResultsContext } from "../context/ResultsContext";

// ------------------ Home Component ------------------
export default function Home() {
  const [mode, setMode] = useState("simple");
  const [dslText, setDslText] = useState("");
  const [registry, setRegistry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const navigate = useNavigate();
  const { setResults } = useContext(ResultsContext);

  const [tickers, setTickers] = useState(["AAPL"]);
  const [dataTimeframes, setDataTimeframes] = useState([]);
  const [executionTF, setExecutionTF] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [side, setSide] = useState("LONG");
  const [blocks, setBlocks] = useState({});
  const [conditions, setConditions] = useState({});

  // Fetch registry
  useEffect(() => {
    (async () => {
      const res = await API.get("/api/registry/");
      setRegistry(res.data);

      const initialBlocks = {};
      Object.keys(res.data.commands.COMMANDS || {}).forEach((s) => {
        initialBlocks[s] = {};
      });
      setBlocks(initialBlocks);
    })();
  }, []);

  // ------------------ Helpers -------------------
  const addTicker = () => setTickers([...tickers, ""]);
  const updateTicker = (i, v) => {
    const t = [...tickers];
    t[i] = v;
    setTickers(t);
  };
  const removeTicker = (i) => setTickers(tickers.filter((_, idx) => idx !== i));

  const addBlock = (blockName) => {
    setBlocks(prev => {
      const sideBlocks = { ...(prev[side] || {}) };
      sideBlocks[blockName] = { ARGUMENTS: {} };
      return { ...prev, [side]: sideBlocks };
    });
  };

  const removeBlock = (blockName) => {
    const updated = { ...blocks };
    delete updated[side][blockName];
    setBlocks(updated);
  };


  const updateArgument = (block, arg, value, availableArgs = {}) => {
    const collectChildren = (parent) => {
      let children = {};
      Object.keys(availableArgs).forEach(k => {
        if (availableArgs[k].parent === parent) {
          children[k] = availableArgs[k].default ?? null;
          Object.assign(children, collectChildren(k));
        }
      });
      return children;
    };

    setBlocks(prev => {
      const sideBlocks = { ...prev[side] };
      const blockData = { ...(sideBlocks[block] || { ARGUMENTS: {} }) };

      const updatedArgs = { ...blockData.ARGUMENTS, [arg]: value };
      Object.assign(updatedArgs, collectChildren(arg));

      blockData.ARGUMENTS = updatedArgs;
      sideBlocks[block] = blockData;
      return { ...prev, [side]: sideBlocks };
    });
  };




  const serializeConditions = (cond) => {
    if (!cond) return null;

    if (cond.type === "cond") {
      const serializeSide = (side) => {
        if (side.type === "value") return { value: side.value };
        if (side.type === "indicator") return { func: side.func, arg: side.args || {} };
        return null;
      };

      return {
        left: serializeSide(cond.left),
        operator: cond.operator,
        right: serializeSide(cond.right),
      };
    }

    if (cond.type === "group") {
      const children = cond.children.map(serializeConditions).filter(Boolean);
      if (!children.length) return null;
      return { [cond.operator]: children };
    }

    return null;
  };


  const buildJsonDsl = () => {
    if (!blocks[side]) return { [side]: { context: {} } };

    const outBlocks = {};

    Object.entries(blocks[side]).forEach(([blockName, blockData]) => {
      outBlocks[blockName] = {
        ARGUMENTS: blockData.ARGUMENTS || {},
      };

      const conds = conditions[blockName] || [];
      if (conds.length > 0) {
        if (conds.length === 1) {
          outBlocks[blockName].CONDITIONS = serializeConditions(conds[0]);
        } else {
          outBlocks[blockName].CONDITIONS = {
            AND: conds.map(serializeConditions).filter(Boolean),
          };
        }
      }
    });

    return {
      [side]: {
        ...outBlocks,
        context: {
          tickers,
          execution_timeframe: executionTF,
          data_timeframes: dataTimeframes,
          dateframe: { start: dateStart, end: dateEnd },
        },
      },
    };
  };

  const addExample = () => {
    const exampleText = ':TICKER(AAPL,MSFT,GOOG) :EXECUTION_TIMEFRAME(1h) :DATA_TIMEFRAMES(1h,4h) :DATEFRAME(2024-01-01, 2025-11-01) :LONG(    OPEN{        CONDITIONS{            RSI() < 30 AND PRICE() > 150        }        |ARGUMENTS{            initialOpenPositionInvestType = percentCashBalance            |initialOpenPositionInvestAmount = 0.1            |recurring=true            |stopLossPercent =6            |takeProfitPercent = 10        }    }    |CLOSE{         CONDITIONS{             RSI(offset=1) > 75         }    } )';
    setDslText(exampleText);
  };


    const runDsl = async () => {
      try {
        setLoading(true);
        setError("");

        let res;

        if (mode === "simple") {
          // Build JSON from simple mode
          const payloadDsl = buildJsonDsl();
          console.log("DSL JSON:", JSON.stringify(payloadDsl, null, 2));
          alert(JSON.stringify(payloadDsl, null, 2));

          res = await API.post("/api/backtestDSLJSON/", { dsl_json: payloadDsl });

        } else if (mode === "advanced") {
          // Send raw DSL text for advanced mode
          console.log("DSL TEXT:", dslText);

          res = await API.post("/api/backtestDSLText/", { dsl_text: dslText });
        }

        setResults(res.data);
        navigate("/analysis");

      } catch (err) {
        setError(err?.response?.data?.detail || err.message || "Error running DSL");
      } finally {
        setLoading(false);
      }
    };



  if (!registry) return <div>Loading registry...</div>;

  const blockNames = Object.keys(blocks[side] || {});
  const allowedArgs = registry.arguments?.ARGUMENTS?.[side] || {};

  return (
    <div className="app-root">
      <h1>ORCA</h1>

      {/* Mode Toggle */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <button className={mode === "simple" ? "btn-primary" : "btn"} onClick={() => setMode("simple")}>
          Simple Mode
        </button>
        <button className={mode === "advanced" ? "btn-primary" : "btn"} onClick={() => setMode("advanced")}>
          Advanced Mode
        </button>
      </div>

      {mode === "simple" && (
        <div className="card">
          <h2>Strategy Builder</h2>

          {/* Tickers */}
          <h4>Tickers</h4>
          {tickers.map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 8 }}>
              <input value={t} onChange={(e) => updateTicker(i, e.target.value)} placeholder="AAPL" />
              {i > 0 && <button onClick={() => removeTicker(i)}>-</button>}
            </div>
          ))}
          <button onClick={addTicker}>+ Add Ticker</button>

          {/* Data Timeframes */}
          <h4 style={{ marginTop: 20 }}>Data Timeframes</h4>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {["1m", "5m", "15m", "1h", "4h", "1d"].map(tf => (
              <label key={tf} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  type="checkbox"
                  checked={dataTimeframes.includes(tf)}
                  onChange={(e) => {
                    if (e.target.checked) setDataTimeframes([...dataTimeframes, tf]);
                    else setDataTimeframes(dataTimeframes.filter(t => t !== tf));
                    if (!e.target.checked && executionTF === tf) setExecutionTF("");
                  }}
                />
                {tf}
              </label>
            ))}
          </div>

          {/* Execution Timeframe */}
          <h4 style={{ marginTop: 20 }}>Execution Timeframe</h4>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {dataTimeframes.length === 0 && <div style={{ color: "#777" }}>Select data timeframes first</div>}
            {dataTimeframes.map(tf => (
              <label key={tf} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  type="radio"
                  name="executionTF"
                  value={tf}
                  checked={executionTF === tf}
                  onChange={() => setExecutionTF(tf)}
                />
                {tf}
              </label>
            ))}
          </div>

          {/* Dates */}
          <h4 style={{ marginTop: 20 }}>Dateframe</h4>
          <div style={{ display: "flex", gap: 10 }}>
            <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
            <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
          </div>

          {/* Side */}
          <h4 style={{ marginTop: 20 }}>Side</h4>
          <select value={side} onChange={(e) => setSide(e.target.value)}>
            {Object.keys(registry.commands.COMMANDS).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Blocks */}
          <h4 style={{ marginTop: 20 }}>Blocks</h4>
          {["OPEN", "CLOSE"].map((b) =>
            !blocks[side][b] ? (
              <button key={b} onClick={() => addBlock(b)}>+ Add {b}</button>
            ) : null
          )}

          {/* Render blocks with arguments only */}
          {blockNames.map((block) => (
            <div key={block} style={{ marginTop: 20, border: "1px solid #888", padding: 10 }}>
              <h3>
                {block}{" "}
                <button onClick={() => removeBlock(block)} style={{ marginLeft: 10 }}>- Remove</button>
              </h3>

              <h4 style={{ marginTop: 10 }}>Conditions</h4>
                <ConditionBuilder
                conditions={conditions[block] || []}
                setConditions={(newConds) => setConditions({ ...conditions, [block]: newConds })}
                registry={registry}
              />


              <h4 style={{ marginTop: 10 }}>Arguments</h4>
              <NestedArgumentSelector
                block={block}
                availableArgs={allowedArgs[block] || {}}
                currentArgs={blocks[side][block].ARGUMENTS}
                onChange={(arg, val) => updateArgument(block, arg, val, allowedArgs[block] || {})}
              />
            </div>
          ))}

          <button className="btn" style={{ marginTop: 20 }} onClick={runDsl} disabled={loading}>
            {loading ? "Running..." : "Run"}
          </button>
        </div>
      )}

      {mode === "advanced" && (
        <div className="card">
          <h2>Advanced DSL</h2>
          <textarea value={dslText} onChange={(e) => setDslText(e.target.value)} rows={15} style={{ width: "100%" }} />
          <div style={{ marginTop: 10 }}>

            <button className="btn" style={{ marginTop: 10, marginRight: 10 }} onClick={addExample}>
                Add Example
            </button>

            <button className="btn" onClick={runDsl} disabled={loading}>
              {loading ? "Running..." : "Run DSL"}
            </button>
          </div>
        </div>
      )}

      {error && <div style={{ color: "red" }}>{error}</div>}
    </div>
  );
}

// ------------------ Condition / Group Builder ------------------
function ConditionBuilder({ conditions, setConditions, registry }) {
  // ------------------ Add Condition / Group ------------------
  const addCondition = () => {
    if (conditions.filter(c => c != null).length >= 1) return;
    setConditions([
      ...conditions,
      {
        type: "cond",
        left: { type: "value", value: 0, func: "", args: {} },
        operator: "<",
        right: { type: "value", value: 0, func: "", args: {} },
      },
    ]);
  };

  const addGroup = () => {
    if (conditions.filter(c => c != null).length >= 1) return;
    setConditions([...conditions, { type: "group", operator: "AND", children: [] }]);
  };

  const updateCondition = (index, newCond) => {
    const updated = [...conditions];
    if (!newCond) updated.splice(index, 1);
    else updated[index] = newCond;
    setConditions(updated.filter(Boolean));
  };

  // ------------------ Render Single Condition ------------------
  const renderCond = (cond, index, parentUpdate) => {
    const renderSide = (sideKey) => {
      const side = cond[sideKey];
      return (
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          {/* Type selector */}
          <select
            value={side.type}
            onChange={(e) =>
              parentUpdate({
                ...cond,
                [sideKey]: {
                  type: e.target.value,
                  value: e.target.value === "value" ? 0 : "",
                  func: "",
                  args: {},
                },
              })
            }
          >
            <option value="value">Value</option>
            <option value="indicator">Indicator</option>
          </select>

          {/* Input based on type */}
          {side.type === "value" ? (
            <input
              type="number"
              value={side.value}
              onChange={(e) => {
                const val = e.target.value;
                parentUpdate({
                  ...cond,
                  [sideKey]: { ...side, value: val === "" ? "" : parseFloat(val) },
                });
              }}
            />
          ) : (
            <select
              value={side.func}
              onChange={(e) => {
                const func = e.target.value;
                const args = {};
                if (registry.indicators.INDICATORS[func]) {
                  Object.entries(registry.indicators.INDICATORS[func].defaults).forEach(
                    ([k, v]) => (args[k] = v)
                  );
                }
                parentUpdate({ ...cond, [sideKey]: { ...side, func, args } });
              }}
            >
              <option value="">Select Indicator</option>
              {Object.keys(registry.indicators.INDICATORS).map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          )}
        </div>
      );
    };

    return (
      <div key={index} style={{ display: "flex", gap: 5, marginLeft: 20, alignItems: "center" }}>
        {renderSide("left")}
        <select
          value={cond.operator}
          onChange={(e) => parentUpdate({ ...cond, operator: e.target.value })}
        >
          {["<", ">", "<=", ">=", "==", "!="].map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
        {renderSide("right")}
        <button onClick={() => parentUpdate(null)}>-</button>
      </div>
    );
  };

  // ------------------ Render Group ------------------
  const renderGroup = (group, index, parentUpdate) => {
    const updateChild = (childIndex, child) => {
      const children = group.children.filter((c) => c != null);
      if (!child || child === "REMOVE") children.splice(childIndex, 1);
      else children[childIndex] = child;
      parentUpdate({ ...group, children });
    };

    const addChildCondition = () => {
      if (group.children.filter((c) => c != null).length >= 2) return;
      parentUpdate({
        ...group,
        children: [
          ...group.children,
          { type: "cond", left: { type: "value", value: 0, func: "", args: {} }, operator: "<", right: { type: "value", value: 0, func: "", args: {} } },
        ],
      });
    };

    const addChildGroup = () => {
      if (group.children.filter((c) => c != null).length >= 2) return;
      parentUpdate({
        ...group,
        children: [...group.children, { type: "group", operator: "AND", children: [] }],
      });
    };

    const removeGroup = () => parentUpdate(null);

    return (
      <div
        key={index}
        style={{ marginLeft: 20, borderLeft: "2px solid #aaa", paddingLeft: 10, marginTop: 5 }}
      >
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <strong>Group ({group.operator})</strong>
          <button
            onClick={() =>
              parentUpdate({ ...group, operator: group.operator === "AND" ? "OR" : "AND" })
            }
          >
            Toggle AND/OR
          </button>
          <button onClick={removeGroup}>Remove Group</button>
          <button onClick={addChildCondition}>+ Condition</button>
          <button onClick={addChildGroup}>+ Group</button>
        </div>
        {group.children
          .filter((c) => c != null)
          .map((c, i) =>
            c.type === "cond"
              ? renderCond(c, i, (updated) => updateChild(i, updated))
              : renderGroup(c, i, (updated) => updateChild(i, updated))
          )}
      </div>
    );
  };

  return (
    <div>
      <button onClick={addCondition}>+ Add Condition</button>
      <button onClick={addGroup}>+ Add Group</button>
      {conditions
        .filter((c) => c != null)
        .map((c, i) =>
          c.type === "cond"
            ? renderCond(c, i, (updated) => updateCondition(i, updated))
            : renderGroup(c, i, (updated) => updateCondition(i, updated))
        )}
    </div>
  );
}



// ------------------ Nested Argument Selector ------------------
function NestedArgumentSelector({ block, availableArgs, currentArgs, onChange }) {
  const [addedArgs, setAddedArgs] = useState(
    Object.keys(currentArgs || {}).filter(arg => !availableArgs[arg]?.parent)
  );

  useEffect(() => {
    setAddedArgs(Object.keys(currentArgs || {}).filter(arg => !availableArgs[arg]?.parent));
  }, [currentArgs, availableArgs]);

  const addArg = (arg) => {
    if (!addedArgs.includes(arg)) {
      setAddedArgs([...addedArgs, arg]);
      // Initialize the argument in blocks with its default value
      const defaultVal = availableArgs[arg]?.default ?? null;
      onChange(arg, defaultVal);

      // Optionally, also initialize child arguments
      Object.keys(availableArgs)
        .filter(child => availableArgs[child].parent === arg)
        .forEach(child => onChange(child, availableArgs[child].default ?? null));
    }
  };


  const removeArg = (arg) => {
    setAddedArgs(addedArgs.filter(a => a !== arg));
    onChange(arg, undefined);
    Object.keys(availableArgs)
      .filter(a => availableArgs[a].parent === arg)
      .forEach(c => onChange(c, undefined));
  };

  const topLevelArgs = Object.keys(availableArgs).filter(a => !availableArgs[a].parent);

  return (
    <div>
      {addedArgs.map((arg) => {
        const argData = availableArgs[arg];
        if (!argData) return null;

        const defaultVal = argData.default;
        const valType = typeof defaultVal; // "boolean", "number", "string"

        return (
          <div key={arg} style={{ marginBottom: 10, paddingLeft: 0 }}>
            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <label style={{ minWidth: 180 }}>{arg}</label>

              {valType === "boolean" ? (
                <select
                  value={currentArgs?.[arg] ?? defaultVal}
                  onChange={(e) => onChange(arg, e.target.value === "true")}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : valType === "number" ? (
                <input
                  type="number"
                  value={currentArgs?.[arg] ?? defaultVal}
                  onChange={(e) => {
                    const val = e.target.value;
                    onChange(arg, val === "" ? "" : parseFloat(val));
                  }}
                />
              ) : argData.options ? (
                <select
                  value={currentArgs?.[arg] ?? defaultVal}
                  onChange={(e) => onChange(arg, e.target.value)}
                >
                  {argData.options.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={currentArgs?.[arg] ?? defaultVal}
                  onChange={(e) => onChange(arg, e.target.value)}
                />
              )}

              <button onClick={() => removeArg(arg)}>-</button>
            </div>

            {/* Render children recursively */}
            {Object.keys(availableArgs)
            .filter(child => availableArgs[child].parent === arg)
            .map(child => {
              const childDefault = availableArgs[child].default;
              const childVal = currentArgs?.[child] ?? childDefault;

              return (
                <div
                  key={child}
                  style={{ marginLeft: 24, marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}
                >
                  <label style={{ minWidth: 160 }}>{child}</label>

                  {typeof childDefault === "boolean" ? (
                    <select
                      value={childVal}
                      onChange={(e) => onChange(child, e.target.value === "true")}
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : typeof childDefault === "number" ? (
                    <input
                      type="number"
                      value={childVal}
                      onChange={(e) => {
                        const val = e.target.value;
                        onChange(child, val === "" ? "" : parseFloat(val));
                      }}
                    />
                  ) : childDefault && availableArgs[child].options ? (
                    <select
                      value={childVal}
                      onChange={(e) => onChange(child, e.target.value)}
                    >
                      {availableArgs[child].options.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={childVal}
                      onChange={(e) => onChange(child, e.target.value)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        );
      })}



      {topLevelArgs.length > 0 && (
        <select onChange={(e) => { if (e.target.value) addArg(e.target.value); e.target.value = ""; }} defaultValue="">
          <option value="" disabled>Add argument...</option>
          {topLevelArgs.filter(a => !addedArgs.includes(a)).map(arg => (
            <option key={arg} value={arg}>{arg}</option>
          ))}
        </select>
      )}
    </div>
  );
}
