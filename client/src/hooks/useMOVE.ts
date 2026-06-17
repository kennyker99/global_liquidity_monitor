import { useState, useEffect } from "react";

interface MOVEData {
  value: string;
  previousValue: string;
  date: string;
  changeValue: string;
  changePercent: string;
}

export function useMOVE(): { data: MOVEData | null; isLoading: boolean } {
  const [data, setData] = useState<MOVEData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchMOVE() {
      try {
        const res = await fetch(
          "https://query1.finance.yahoo.com/v8/finance/chart/%5EMOVE?interval=1d&range=5d",
          {
            headers: {
              "Accept": "application/json",
            },
          }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const result = json?.chart?.result?.[0];
        if (!result) throw new Error("No result");

        const closes: number[] = result.indicators?.quote?.[0]?.close || [];
        const timestamps: number[] = result.timestamp || [];

        let latestIdx = closes.length - 1;
        while (latestIdx >= 0 && closes[latestIdx] == null) latestIdx--;
        if (latestIdx < 0) throw new Error("No valid closes");

        const price = closes[latestIdx]!;
        const prev = latestIdx > 0 ? closes[latestIdx - 1] ?? price : price;
        const change = price - prev;
        const changePct = prev !== 0 ? (change / Math.abs(prev)) * 100 : 0;
        const ts = timestamps[latestIdx];
        const date = ts
          ? new Date(ts * 1000).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);

        setData({
          value: price.toFixed(2),
          previousValue: prev.toFixed(2),
          date,
          changeValue: change.toFixed(4),
          changePercent: changePct.toFixed(2),
        });
      } catch (err) {
        console.error("[useMOVE] Failed:", err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchMOVE();
  }, []);

  return { data, isLoading };
}
