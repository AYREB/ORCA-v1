import React, { useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";

export default function CandleChart({ candles = [], trades = [], showTrades = true }) {
  const ref = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    // cleanup previous
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }
    const chart = createChart(ref.current, {
        width: ref.current.clientWidth,
        height: 420,
        layout: {
            background: { color: "#161b22" },   // matches --card
            textColor: "#e6edf3"                // matches --text
        },
        grid: {
            vertLines: { color: "#1d232d" },    // subtle GS-style grid
            horzLines: { color: "#1d232d" }
        },
        crosshair: {
            mode: 1
        },
        rightPriceScale: {
            borderColor: "#2a3038"
        },
        timeScale: {
            borderColor: "#2a3038"
        }
    });

    chartRef.current = chart;

    const series = chart.addCandlestickSeries();

    // map candles to lightweight format. Accept both string datetimes and yyyy-mm-dd timestamps.
    const data = (candles || []).map((c) => {
      const iso = c.Datetime || c.time || c.date;
      // lightweight-charts accepts 'yyyy-mm-dd' or timestamp (unix)
      let time;
      try {
        const dt = new Date(iso);
        time = Math.floor(dt.getTime() / 1000);
      } catch {
        time = iso;
      }
      return { time, open: c.Open, high: c.High, low: c.Low, close: c.Close };
    });

    series.setData(data);

    if (showTrades && trades && trades.length) {
        const markers = trades.map((t) => {
            const time = Math.floor(new Date(t.timestamp).getTime() / 1000);

            // default values
            let position = "belowBar";
            let color = "green";
            let shape = "arrowUp";

            if (t.type === "SELL") {
            position = "aboveBar";
            color = "red";
            shape = "arrowDown";
            } 
            else if (t.type === "RECURRING_BUY") {
            position = "belowBar";
            color = "#2b7cff";        // blue
            shape = "arrowUp";
            }

            return {
            time,
            position,
            color,
            shape,
            text: `${t.type} ${t.ticker}`
            };
    });

    series.setMarkers(markers);
    }


    const resize = () => chart.applyOptions({ width: ref.current.clientWidth });
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.remove();
    };
  }, [candles, trades, showTrades]);

  return (
    <div className="card candle-chart-container">
        <div ref={ref} style={{ width: "100%" }} />
    </div>
    );

}
