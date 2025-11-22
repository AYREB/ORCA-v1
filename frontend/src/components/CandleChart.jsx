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
    const chart = createChart(ref.current, { width: ref.current.clientWidth, height: 420 });
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
        let time = Math.floor(new Date(t.timestamp).getTime() / 1000);
        return {
          time,
          position: t.type === "BUY" ? "belowBar" : "aboveBar",
          color: t.type === "BUY" ? "green" : "red",
          shape: t.type === "BUY" ? "arrowUp" : "arrowDown",
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

  return <div className="card" style={{ padding: 8 }}><div ref={ref} style={{ width: "100%" }} /></div>;
}
