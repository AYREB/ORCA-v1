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
    const updated = { ...blocks };
    updated[side][blockName] = { ARGUMENTS: {} };
    setBlocks(updated);
  };
  const removeBlock = (blockName) => {
    const updated = { ...blocks };
    delete updated[side][blockName];
    setBlocks(updated);
  };

  const updateArgument = (block, arg, value) => {
    const updated = { ...blocks };
    if (!updated[side][block]) updated[side][block] = { ARGUMENTS: {} };
    updated[side][block].ARGUMENTS[arg] = value;
    setBlocks(updated);
  };

  const buildJsonDsl = () => {
    const outBlocks = {};
    Object.keys(blocks[side] || {}).forEach((b) => {
    outBlocks[b] = { ARGUMENTS: blocks[side][b].ARGUMENTS || {} };

    if (conditions[b] && conditions[b].length > 0) {
        outBlocks[b].CONDITIONS = conditions[b]; // <-- add this line
    }
    });


    return {
      [side]: {
        ...outBlocks,
        context: {
          tickers,
          execution_timeframe: executionTF,
          data_timeframes,
          dateframe: { start: dateStart, end: dateEnd }
        }
      }
    };
  };

  const addExample = () => {
    const exampleText = ':TICKER(AAPL,MSFT,GOOG) :EXECUTION_TIMEFRAME(1h) :DATA_TIMEFRAMES(1h,4h) :DATEFRAME(2024-01-01, 2025-11-01) :LONG(    OPEN{        CONDITIONS{            RSI() < 30 AND PRICE() > 150        }        |ARGUMENTS{            initialOpenPositionInvestType = percentCashBalance            |initialOpenPositionInvestAmount = 0.1            |recurring=true            |stopLossPercent =6            |takeProfitPercent = 10        }    }    |CLOSE{         CONDITIONS{             RSI(offset=1) > 75         }    } )';
    setDslText(exampleText);
  };


    const runDsl = async () => {
    try {
        // If in advanced mode, just send the raw DSL text instead of parsing
        const payloadDsl = mode === "advanced" ? dslText : buildJsonDsl();

        setLoading(true);
        const res = await API.post("/api/backtest/", { dsl: payloadDsl });
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
                onChange={(arg, val) => updateArgument(block, arg, val)}
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
    const addCondition = () => {
    if (conditions.filter(c => c != null).length >= 1) return;
    setConditions([
        ...conditions,
        { type: "cond", left: { func: "", arg: {} }, operator: "<", right: { value: 0 } }
    ]);
    };

    const addGroup = () => {
    if (conditions.filter(c => c != null).length >= 1) return;
    setConditions([
        ...conditions,
        { type: "group", operator: "AND", children: [] }
    ]);
    };
  const updateCondition = (index, newCond) => {
    const c = [...conditions];
    if (!newCond) {
        c.splice(index, 1); // remove the null condition
    } else {
        c[index] = newCond;
    }
    setConditions(c.filter(Boolean)); // <-- filter out nulls
  };



  const removeCondition = (index) => {
    const c = [...conditions];
    c.splice(index, 1);
    setConditions(c);
  };

  const renderCondition = (cond, index, parentUpdate) => {
    if (cond.type === "cond") {
      return (
        <div key={index} style={{ display: "flex", gap: 5, marginLeft: 20, alignItems: "center" }}>
          <select
            value={cond.left.func}
            onChange={(e) => {
              const func = e.target.value;
              const args = {};
              if (registry.indicators.INDICATORS[func]) {
                Object.entries(registry.indicators.INDICATORS[func].defaults).forEach(([k, v]) => args[k] = v);
              }
              parentUpdate({ ...cond, left: { func, arg: args } });
            }}
          >
            <option value="">Select Indicator</option>
            {Object.keys(registry.indicators.INDICATORS).map(i => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>

          <select value={cond.operator} onChange={(e) => parentUpdate({ ...cond, operator: e.target.value })}>
            {["<", ">", "<=", ">=", "==", "!="].map(op => <option key={op} value={op}>{op}</option>)}
          </select>

          {cond.left.func ? (
            <input
              type="number"
              value={cond.right.value}
              onChange={(e) => parentUpdate({ ...cond, right: { value: parseFloat(e.target.value) } })}
            />
          ) : (
            <input
              type="text"
              value={cond.right.value}
              onChange={(e) => parentUpdate({ ...cond, right: { value: e.target.value } })}
            />
          )}

            <button onClick={() => parentUpdate(null)}>-</button>
        </div>
      );
    }

    if (cond.type === "group") {
        const updateChild = (childIndex, child) => {
            let newChildren = cond.children.filter(c => c != null);
            if (child === null || child === "REMOVE") {
                newChildren.splice(childIndex, 1); // remove the child entirely
            } else {
                newChildren[childIndex] = child;
            }
            parentUpdate({ ...cond, children: newChildren });
        };




        const addChildCondition = () => {
            const currentChildren = cond.children.filter(c => c != null);
            if (currentChildren.length >= 2) return; // max 2 children
            parentUpdate({ 
                ...cond, 
                children: [...currentChildren, { type: "cond", left: { func: "", arg: {} }, operator: "<", right: { value: 0 } }] 
            });
        };


        const addChildGroup = () => {
            const currentChildren = cond.children.filter(c => c != null);
            if (currentChildren.length >= 2) return; // max 2 children
            parentUpdate({ ...cond, children: [...cond.children, { type: "group", operator: "AND", children: [] }] });
        };


      const removeGroup = () => parentUpdate(null);


      return (
        <div key={index} style={{ marginLeft: 20, borderLeft: "2px solid #aaa", paddingLeft: 10, marginTop: 5 }}>
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <strong>Group ({cond.operator})</strong>
            <button onClick={() => parentUpdate({ ...cond, operator: cond.operator === "AND" ? "OR" : "AND" })}>Toggle AND/OR</button>
            <button onClick={removeGroup}>Remove Group</button>
            <button onClick={addChildCondition}>+ Condition</button>
            <button onClick={addChildGroup}>+ Group</button>
          </div>

            {cond.children
                .filter(c => c !== null) 
                .map((c, i) =>
                    renderCondition(c, i, (updated) => updateChild(i, updated))
                )
            }

        </div>
      );
    }
  };

  return (
    <div>
      <button onClick={addCondition}>+ Add Condition</button>
      <button onClick={addGroup}>+ Add Group</button>
        {conditions
        .filter(c => c !== null) // <-- add this
        .map((c, i) => renderCondition(c, i, (updated) => updateCondition(i, updated)))}

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
    if (!addedArgs.includes(arg)) setAddedArgs([...addedArgs, arg]);
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
        const isBool = argData.type === "bool";

        return (
          <div key={arg} style={{ marginBottom: 10, paddingLeft: 0 }}>
            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <label style={{ minWidth: 180 }}>{arg}</label>
              {isBool ? (
                <select value={currentArgs?.[arg] ?? argData.default} onChange={(e) => onChange(arg, e.target.value === "true")}>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : argData.options ? (
                <select value={currentArgs?.[arg] ?? argData.default} onChange={(e) => onChange(arg, e.target.value)}>
                  {argData.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : (
                <input type="text" value={currentArgs?.[arg] ?? argData.default} onChange={(e) => onChange(arg, e.target.value)} />
              )}
              <button onClick={() => removeArg(arg)}>-</button>
            </div>

            {Object.keys(availableArgs)
              .filter(child => availableArgs[child].parent === arg)
              .map(child => {
                const childData = availableArgs[child];
                if (!childData) return null;
                const childIsBool = childData.type === "bool";

                return (
                  <div key={child} style={{ marginLeft: 24, marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
                    <label style={{ minWidth: 160 }}>{child}</label>
                    {childIsBool ? (
                      <select value={currentArgs?.[child] ?? childData.default} onChange={(e) => onChange(child, e.target.value === "true")}>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : childData.options ? (
                      <select value={currentArgs?.[child] ?? childData.default} onChange={(e) => onChange(child, e.target.value)}>
                        {childData.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : (
                      <input type="text" value={currentArgs?.[child] ?? childData.default} onChange={(e) => onChange(child, e.target.value)} />
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
