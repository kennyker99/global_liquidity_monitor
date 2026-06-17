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

// ─── MOVE：Yahoo Finance ^MOVE (crumb auth + symbol fallback + logging) ───────

let _yahooCookie: string | null = null;
let _yahooCrumb: string | null = null;

/** 获取 Yahoo Finance 的 cookie + crumb（绕过 2024 年后的反爬认证） */
async function getYahooCrumb(): Promise<{ cookie: string; crumb: string } | null> {
  try {
    // Step 1: 获取 cookie（访问任意 Yahoo 页面）
    const cookieRes = await axios.get("https://fc.yahoo.com", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true, // fc.yahoo.com 可能返回 404 但仍带 set-cookie
    });
    const setCookie = cookieRes.headers["set-cookie"];
    const cookie = Array.isArray(setCookie)
      ? setCookie.map((c) => c.split(";")[0]).join("; ")
      : "";
    if (!cookie) {
      console.warn("[RiskClient][MOVE] getYahooCrumb: no cookie returned");
      return null;
    }

    // Step 2: 用 cookie 换 crumb
    const crumbRes = await axios.get(
      "https://query1.finance.yahoo.com/v1/test/getcrumb",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Cookie: cookie,
        },
        timeout: 10000,
      }
    );
    const crumb = String(crumbRes.data || "");
    if (!crumb || crumb.includes("<")) {
      console.warn("[RiskClient][MOVE] getYahooCrumb: invalid crumb:", crumb.slice(0, 40));
      return null;
    }
    _yahooCookie = cookie;
    _yahooCrumb = crumb;
    console.log("[RiskClient][MOVE] getYahooCrumb: success, crumb obtained");
    return { cookie, crumb };
  } catch (err) {
    console.error("[RiskClient][MOVE] getYahooCrumb failed:", (err as Error).message);
    return null;
  }
}

/** 解析 Yahoo chart 响应为 { price, previousClose, date } */
function parseYahooChart(
  result: any,
  symbol: string
): { price: number; previousClose: number; date: string } | null {
  if (!result) {
    console.warn(`[RiskClient][MOVE] ${symbol}: chart.result[0] 为空`);
    return null;
  }
  const meta = result.meta ?? {};
  const metaPrice = meta.regularMarketPrice;
  const metaPrevClose = meta.chartPreviousClose ?? meta.previousClose;
  const metaTime = meta.regularMarketTime; // 秒级时间戳
  const timestamps: number[] = result.timestamp || [];
  const closes: number[] = result.indicators?.quote?.[0]?.close || [];

  // close 数组里最新的非空值（chart API 对指数最近几天常为 null/滞后）
  let latestIdx = closes.length - 1;
  while (latestIdx >= 0 && closes[latestIdx] == null) latestIdx--;
  const latestClose = latestIdx >= 0 ? closes[latestIdx]! : null;

  // 关键修复：优先用 meta.regularMarketPrice（最新成交价），它比 close 数组新。
  // close 数组只在 meta 没有价时作回退。
  const price = metaPrice ?? latestClose;
  if (price == null) {
    console.warn(`[RiskClient][MOVE] ${symbol}: 无可用价格 (meta=${metaPrice}, closes=${closes.length})`);
    return null;
  }

  // previousClose：优先 meta.chartPreviousClose；否则用 close 数组里早一格的值。
  // 若 meta 价 == 最新 close（同一天），则前收应取 close[latestIdx-1]。
  let previousClose: number;
  if (metaPrevClose != null && (latestClose == null || metaPrice !== latestClose)) {
    previousClose = metaPrevClose;
  } else if (latestIdx > 0 && closes[latestIdx - 1] != null) {
    previousClose = closes[latestIdx - 1]!;
  } else {
    previousClose = metaPrevClose ?? price;
  }

  // 日期：优先 meta.regularMarketTime（最新），否则用最新 close 的时间戳
  let date: string;
  if (metaTime) {
    date = new Date(metaTime * 1000).toISOString().slice(0, 10);
  } else if (latestIdx >= 0 && timestamps[latestIdx]) {
    date = new Date(timestamps[latestIdx]! * 1000).toISOString().slice(0, 10);
  } else {
    date = new Date().toISOString().slice(0, 10);
  }

  console.log(
    `[RiskClient][MOVE] ${symbol} parse: price=${price} (meta=${metaPrice}, lastClose=${latestClose}), prevClose=${previousClose}, date=${date}`
  );
  return { price, previousClose, date };
}

/**
 * 从 Yahoo Finance 抓取单个 symbol 的最新价。
 * 注意：^ 必须 encode 成 %5E（encodeURIComponent 自动处理）。
 */
async function yahooFetchSingle(symbol: string): Promise<{
  price: number;
  previousClose: number;
  date: string;
} | null> {
  const encoded = encodeURIComponent(symbol); // ^MOVE → %5EMOVE
  const auth =
    _yahooCookie && _yahooCrumb
      ? { cookie: _yahooCookie, crumb: _yahooCrumb }
      : await getYahooCrumb();

  for (const base of [
    "https://query1.finance.yahoo.com",
    "https://query2.finance.yahoo.com",
  ]) {
    const crumbParam = auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : "";
    const url = `${base}/v8/finance/chart/${encoded}?interval=1d&range=10d${crumbParam}`;
    console.log(`[RiskClient][MOVE] 请求 URL: ${url}`);
    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://finance.yahoo.com",
          ...(auth ? { Cookie: auth.cookie } : {}),
        },
        timeout: 15000,
      });
      const result = response.data?.chart?.result?.[0];
      console.log(
        `[RiskClient][MOVE] ${symbol} @ ${base}: HTTP ${response.status}, chart.result[0] 存在=${!!result}`
      );
      const parsed = parseYahooChart(result, symbol);
      if (parsed) {
        console.log(
          `[RiskClient][MOVE] ${symbol} 解析成功: price=${parsed.price}, prev=${parsed.previousClose}, date=${parsed.date}`
        );
        return parsed;
      }
    } catch (err) {
      const status = (err as any)?.response?.status;
      console.error(
        `[RiskClient][MOVE] ${symbol} @ ${base} 失败: HTTP ${status ?? "?"} ${(err as Error).message}`
      );
      // crumb 可能过期，清掉缓存下次重新获取
      if (status === 401 || status === 403 || status === 429) {
        _yahooCookie = null;
        _yahooCrumb = null;
      }
    }
  }
  return null;
}

/**
 * 抓取 MOVE 最新值。symbol 回退：^MOVE → MOVE。
 */
async function yahooFinanceFetch(symbol: string): Promise<{
  price: number;
  previousClose: number;
  date: string;
} | null> {
  const candidates = symbol === "^MOVE" ? ["^MOVE", "MOVE"] : [symbol];
  for (const sym of candidates) {
    const data = await yahooFetchSingle(sym);
    if (data) return data;
  }
  console.error(`[RiskClient][MOVE] 所有 symbol 候选都失败: ${candidates.join(", ")}`);
  return null;
}

async function yahooFinanceHistoryFetch(
  symbol: string,
  limit = 6
): Promise<Array<{ date: string; value: string }>> {
  try {
    const encodedSymbol = encodeURIComponent(symbol); // ^MOVE → %5EMOVE
    const auth =
      _yahooCookie && _yahooCrumb
        ? { cookie: _yahooCookie, crumb: _yahooCrumb }
        : await getYahooCrumb();
    const crumbParam = auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : "";
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?interval=1d&range=30d${crumbParam}`;
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
        Referer: "https://finance.yahoo.com",
        ...(auth ? { Cookie: auth.cookie } : {}),
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

/** MOVE 统一返回格式（供前端 tRPC 接口直接使用） */
export interface MOVEQuote {
  symbol: string;
  name: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  updatedAt: string;
}

/**
 * 抓取 MOVE 并返回统一格式。即使 change 为 null，只要 price 有值就返回。
 */
export async function fetchMOVEQuote(): Promise<MOVEQuote | null> {
  console.log("[RiskClient][MOVE] fetchMOVEQuote: 开始抓取 ^MOVE ...");
  const data = await yahooFinanceFetch("^MOVE");
  if (!data) {
    console.error("[RiskClient][MOVE] fetchMOVEQuote: 抓取失败，返回 null");
    return null;
  }
  const change =
    data.previousClose && data.previousClose !== data.price
      ? data.price - data.previousClose
      : null;
  const changePercent =
    change !== null && data.previousClose !== 0
      ? (change / Math.abs(data.previousClose)) * 100
      : null;
  const quote: MOVEQuote = {
    symbol: "^MOVE",
    name: "MOVE Index",
    price: data.price,
    change,
    changePercent,
    updatedAt: data.date,
  };
  console.log("[RiskClient][MOVE] fetchMOVEQuote: 返回数据 =", JSON.stringify(quote));
  return quote;
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
