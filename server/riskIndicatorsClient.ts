/**
 * 风险指标数据获取客户端
 * - VIX：来自 FRED (VIXCLS)
 * - MOVE：来自 Yahoo Finance (^MOVE)
 * - US 5Y CDS：来自 worldgovernmentbonds.com（服务端代理，前端 JS 解析）
 */

import axios from "axios";
import * as zlib from "zlib";
import * as https from "https";

// ─── VIX：FRED VIXCLS ────────────────────────────────────────────────────────

export async function fetchVIX(apiKey: string): Promise<{
  value: string;
  date: string;
  previousValue?: string;
  previousDate?: string;
} | null> {
  try {
    const response = await axios.get(
      "https://api.stlouisfed.org/fred/series/observations",
      {
        params: {
          series_id: "VIXCLS",
          api_key: apiKey,
          file_type: "json",
          sort_order: "desc",
          limit: 10,
        },
      }
    );
    const obs = (response.data.observations || []).filter(
      (o: { value: string }) => o.value !== "."
    );
    if (obs.length === 0) return null;
    return {
      value: obs[0].value,
      date: obs[0].date,
      previousValue: obs[1]?.value,
      previousDate: obs[1]?.date,
    };
  } catch (err) {
    console.error("[RiskClient] Failed to fetch VIX:", err);
    return null;
  }
}

export async function fetchVIXHistory(
  apiKey: string,
  limit = 6
): Promise<Array<{ date: string; value: string }>> {
  try {
    const response = await axios.get(
      "https://api.stlouisfed.org/fred/series/observations",
      {
        params: {
          series_id: "VIXCLS",
          api_key: apiKey,
          file_type: "json",
          sort_order: "desc",
          limit: limit + 5,
        },
      }
    );
    const obs = (response.data.observations || [])
      .filter((o: { value: string }) => o.value !== ".")
      .slice(0, limit);
    return obs.map((o: { date: string; value: string }) => ({
      date: o.date,
      value: o.value,
    }));
  } catch (err) {
    console.error("[RiskClient] Failed to fetch VIX history:", err);
    return [];
  }
}

// ─── MOVE：Yahoo Finance ^MOVE (Direct API with headers) ──────────────────────

async function yahooFinanceFetch(symbol: string): Promise<{
  price: number;
  previousClose: number;
  date: string;
} | null> {
  // Direct API call with comprehensive headers to avoid detection/blocking
  for (const base of ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]) {
    try {
      const url = `${base}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=10d`;
      const response = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate",
          "Referer": "https://finance.yahoo.com",
          "DNT": "1",
        },
        timeout: 15000,
      });
      const result = response.data?.chart?.result?.[0];
      if (!result) continue;

      const price = result.meta?.regularMarketPrice;
      if (!price) continue;

      const timestamps: number[] = result.timestamp || [];
      const closes: number[] = result.indicators?.quote?.[0]?.close || [];
      let latestIdx = closes.length - 1;
      while (latestIdx >= 0 && closes[latestIdx] == null) latestIdx--;
      if (latestIdx < 0) continue;

      const previousClose = latestIdx > 0 ? closes[latestIdx - 1] ?? price : price;
      const ts = timestamps[latestIdx];
      const date = ts ? new Date(ts * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
      console.log(`[RiskClient] Fetched ${symbol} via direct API: ${price}`);
      return { price, previousClose, date };
    } catch (err) {
      console.error(`[RiskClient] Direct API failed for ${symbol}:`, (err as Error).message);
    }
  }

  return null;
}

async function yahooFinanceHistoryFetch(
  symbol: string,
  limit = 6
): Promise<Array<{ date: string; value: string }>> {
  try {
    const encodedSymbol = encodeURIComponent(symbol);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?interval=1d&range=30d`;
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      timeout: 10000,
    });

    const result = response.data?.chart?.result?.[0];
    if (!result) return [];

    const timestamps: number[] = result.timestamp || [];
    const closes: number[] = result.indicators?.quote?.[0]?.close || [];

    const records: Array<{ date: string; value: string }> = [];
    for (let i = closes.length - 1; i >= 0 && records.length < limit; i--) {
      if (closes[i] == null) continue;
      const ts = timestamps[i];
      const date = ts
        ? new Date(ts * 1000).toISOString().slice(0, 10)
        : "";
      if (date) {
        records.push({ date, value: closes[i]!.toFixed(2) });
      }
    }
    return records;
  } catch (err) {
    console.error(
      `[RiskClient] Yahoo Finance history fetch failed for ${symbol}:`,
      err
    );
    return [];
  }
}

export async function fetchMOVE(): Promise<{
  value: string;
  date: string;
  previousValue?: string;
} | null> {
  const data = await yahooFinanceFetch("^MOVE");
  if (!data) return null;
  return {
    value: data.price.toFixed(2),
    date: data.date,
    previousValue: data.previousClose.toFixed(2),
  };
}

export async function fetchMOVEHistory(
  limit = 6
): Promise<Array<{ date: string; value: string }>> {
  return yahooFinanceHistoryFetch("^MOVE", limit);
}

// ─── US 5Y CDS：worldgovernmentbonds.com WordPress REST API ─────────────────
// 通过逆向工程发现的 WordPress REST API 端点，可直接从服务端获取 CDS 数据
// POST { GLOBALVAR: jsGlobalVars } → 返回 { success: true, result: { ultimoValore, ... } }

export async function fetchCDS(): Promise<{
  value: string;
  date: string;
  previousValue?: string;
  changePercent?: string;
} | null> {
  try {
    const endpoint = "https://www.worldgovernmentbonds.com/wp-json/common/v1/historical";
    const jsGlobalVars = {
      JS_VARIABLE: "jsGlobalVars",
      FUNCTION: "CDS",
      DOMESTIC: true,
      ENDPOINT: endpoint,
      DATE_RIF: "2099-12-31",
      DEBUG: false,
      OBJ: { UNIT: "", DECIMAL: 2, UNIT_DELTA: "%", DECIMAL_DELTA: 2 },
      COUNTRY1: {
        SYMBOL: "6",
        PAESE: "United States",
        PAESE_UPPERCASE: "UNITED STATES",
        BANDIERA: "us",
        URL_PAGE: "united-states",
      },
      COUNTRY2: null,
      OBJ1: { DURATA_STRING: "5 Years", DURATA: 60 },
      OBJ2: null,
    };

    const response = await axios.post(
      endpoint,
      { GLOBALVAR: jsGlobalVars },
      {
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Referer: "https://www.worldgovernmentbonds.com/cds-historical-data/united-states/5-years/",
          Origin: "https://www.worldgovernmentbonds.com",
          Accept: "application/json",
        },
        timeout: 15000,
      }
    );

    const result = response.data?.result;
    if (!response.data?.success || result?.ultimoValore == null) {
      console.warn("[RiskClient] CDS API returned no data");
      return null;
    }

    const value = String(result.ultimoValore);
    // ultimoTimestampDesc: "16 Jun 2026 13:45" → parse to ISO date
    let date = new Date().toISOString().slice(0, 10);
    if (result.ultimoTimestampDesc) {
      const parsed = new Date(result.ultimoTimestampDesc);
      if (!isNaN(parsed.getTime())) {
        date = parsed.toISOString().slice(0, 10);
      }
    }

    // change1mAbs is the 1-month absolute change in bps
    const changePercent = result.change1mAbs != null ? String(result.change1mAbs) : undefined;

    return { value, date, changePercent };
  } catch (err) {
    console.error("[RiskClient] Failed to fetch CDS:", err);
    return null;
  }
}

export async function fetchCDSHistory(
  limit = 6
): Promise<Array<{ date: string; value: string }>> {
  try {
    const endpoint = "https://www.worldgovernmentbonds.com/wp-json/common/v1/historical";
    const jsGlobalVars = {
      JS_VARIABLE: "jsGlobalVars",
      FUNCTION: "CDS",
      DOMESTIC: true,
      ENDPOINT: endpoint,
      DATE_RIF: "2099-12-31",
      DEBUG: false,
      OBJ: { UNIT: "", DECIMAL: 2, UNIT_DELTA: "%", DECIMAL_DELTA: 2 },
      COUNTRY1: {
        SYMBOL: "6",
        PAESE: "United States",
        PAESE_UPPERCASE: "UNITED STATES",
        BANDIERA: "us",
        URL_PAGE: "united-states",
      },
      COUNTRY2: null,
      OBJ1: { DURATA_STRING: "5 Years", DURATA: 60 },
      OBJ2: null,
    };

    const response = await axios.post(
      endpoint,
      { GLOBALVAR: jsGlobalVars },
      {
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: "https://www.worldgovernmentbonds.com/cds-historical-data/united-states/5-years/",
          Origin: "https://www.worldgovernmentbonds.com",
          Accept: "application/json",
        },
        timeout: 15000,
      }
    );

    const result = response.data?.result;
    if (!response.data?.success || !result?.historicalData) return [];

    // historicalData is array of [timestamp, value] or similar
    const historical = result.historicalData as Array<[number, number]>;
    return historical
      .slice(-limit)
      .reverse()
      .map(([ts, val]) => ({
        date: new Date(ts).toISOString().slice(0, 10),
        value: String(val),
      }));
  } catch (err) {
    console.error("[RiskClient] Failed to fetch CDS history:", err);
    return [];
  }
}

/** @deprecated 旧的 iframe 代理方案，保留供参考 */
export async function fetchCDSProxyHtml(): Promise<string | null> {
  return new Promise((resolve) => {
    const options = {
      hostname: "www.worldgovernmentbonds.com",
      path: "/cds-historical-data/united-states/5-years/",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
      },
    };

    const req = https.get(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (d: Buffer) => chunks.push(d));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const enc = res.headers["content-encoding"];

        const decompress =
          enc === "br"
            ? zlib.brotliDecompress
            : enc === "gzip"
            ? zlib.gunzip
            : (b: Buffer, cb: (err: Error | null, result: Buffer) => void) =>
                cb(null, b);

        decompress(buf, (err, decoded) => {
          if (err) {
            console.error("[RiskClient] CDS decompress error:", err);
            resolve(null);
            return;
          }
          resolve(decoded.toString());
        });
      });
    });

    req.on("error", (e) => {
      console.error("[RiskClient] CDS proxy fetch error:", e);
      resolve(null);
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve(null);
    });
  });
}
