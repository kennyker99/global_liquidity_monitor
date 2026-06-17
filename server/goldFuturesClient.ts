/**
 * CME 黄金期货交割数据获取
 * 数据源: https://www.cmegroup.com/CmeWS/mvc/Volume/Details/F/437/{YYYYMMDD}/P
 *
 * 获取关键指标（TOTALS 行）：
 * - EFP (Exchange for Physical): 期货现货互换
 * - EFR (Exchange for Risk): 风险互换
 * - TAS (Trade At Settlement): 结算时交易
 * - Deliveries: 交割量
 *
 * 注：CME 产品 ID 437 = 黄金期货 (GC)
 */

import axios from "axios";

const CME_VOLUME_API =
  "https://www.cmegroup.com/CmeWS/mvc/Volume/Details/F/437";

// 模拟浏览器请求头，避免被 CME 封锁
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Referer: "https://www.cmegroup.com/markets/metals/precious/gold.volume.html",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
};

export interface GoldFuturesMetrics {
  date: string;
  efp: number;
  efr: number;
  tas: number;
  deliveries: number;
}

interface CMEVolumeTotals {
  efpVol?: string;
  efrVol?: string;
  tasVol?: string;
  deliveries?: string;
}

interface CMEVolumeResponse {
  tradeDate?: string;
  totals?: CMEVolumeTotals;
  updateTime?: string;
  empty?: boolean;
}

/**
 * 将数字字符串（如 "1,193"）转为整数
 */
function parseIntSafe(val: string | undefined): number {
  if (!val || val === "-") return 0;
  return parseInt(val.replace(/,/g, ""), 10) || 0;
}

/**
 * 格式化日期为 YYYYMMDD
 */
function formatDateYYYYMMDD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * 判断是否为工作日（周一到周五）
 */
function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

/**
 * 获取最近 N 个工作日的日期列表（从今天往前）
 */
function getRecentTradingDays(n: number): Date[] {
  const days: Date[] = [];
  const today = new Date();
  // 从昨天开始往前找（CME 数据通常是前一个交易日）
  let cursor = new Date(today);
  cursor.setDate(cursor.getDate() - 1);

  while (days.length < n) {
    if (isWeekday(cursor)) {
      days.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return days;
}

/**
 * 从 CME 获取指定日期的黄金期货成交量数据
 * 返回 null 表示该日期无数据（节假日或数据未发布）
 */
export async function fetchCMEGoldVolumeForDate(
  date: Date
): Promise<GoldFuturesMetrics | null> {
  const dateStr = formatDateYYYYMMDD(date);
  const isoDate = date.toISOString().split("T")[0];

  try {
    const url = `${CME_VOLUME_API}/${dateStr}/P`;
    const response = await axios.get<CMEVolumeResponse>(url, {
      headers: BROWSER_HEADERS,
      params: {
        tradeDate: dateStr,
        pageSize: 500,
        isProtected: "",
        _t: Date.now(),
      },
      timeout: 15000,
    });

    const data = response.data;

    // 检查是否有数据
    if (data.empty || !data.totals) {
      console.log(`[GoldFutures] No data for ${dateStr} (empty or no totals)`);
      return null;
    }

    const totals = data.totals;
    const efp = parseIntSafe(totals.efpVol);
    const efr = parseIntSafe(totals.efrVol);
    const tas = parseIntSafe(totals.tasVol);
    const deliveries = parseIntSafe(totals.deliveries);

    // 如果所有值都是 0，可能是节假日或无数据
    if (efp === 0 && efr === 0 && tas === 0 && deliveries === 0) {
      console.log(`[GoldFutures] All zeros for ${dateStr}, skipping`);
      return null;
    }

    console.log(
      `[GoldFutures] Fetched ${dateStr}: EFP=${efp}, EFR=${efr}, TAS=${tas}, Deliveries=${deliveries}`
    );

    return {
      date: isoDate,
      efp,
      efr,
      tas,
      deliveries,
    };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      console.log(`[GoldFutures] No data for ${dateStr} (404)`);
      return null;
    }
    console.error(`[GoldFutures] Error fetching ${dateStr}:`, error);
    return null;
  }
}

/**
 * 获取最近 N 个交易日的黄金期货数据
 */
export async function getGoldFuturesHistory(
  days: number = 6
): Promise<GoldFuturesMetrics[]> {
  // 多取几天以防节假日
  const tradingDays = getRecentTradingDays(days + 10);
  const results: GoldFuturesMetrics[] = [];

  for (const day of tradingDays) {
    if (results.length >= days) break;
    const metrics = await fetchCMEGoldVolumeForDate(day);
    if (metrics) {
      results.push(metrics);
    }
    // 避免请求过快
    await new Promise((r) => setTimeout(r, 300));
  }

  // 按日期升序排列
  return results.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 获取最新的黄金期货关键指标（最近一个有数据的交易日）
 */
export async function getLatestGoldFuturesMetrics(): Promise<{
  date: string;
  efp: number;
  efr: number;
  tas: number;
  deliveries: number;
  previousEFP?: number;
  previousEFR?: number;
  previousTAS?: number;
  previousDeliveries?: number;
} | null> {
  try {
    const history = await getGoldFuturesHistory(2);

    if (!history || history.length === 0) {
      console.error("[GoldFutures] No data available");
      return null;
    }

    const latest = history[history.length - 1]!;
    const previous = history.length > 1 ? history[history.length - 2] : null;

    return {
      date: latest.date,
      efp: latest.efp,
      efr: latest.efr,
      tas: latest.tas,
      deliveries: latest.deliveries,
      previousEFP: previous?.efp,
      previousEFR: previous?.efr,
      previousTAS: previous?.tas,
      previousDeliveries: previous?.deliveries,
    };
  } catch (error) {
    console.error("[GoldFutures] Failed to get latest metrics:", error);
    return null;
  }
}
