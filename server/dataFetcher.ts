/**
 * 流动性指标数据获取和刷新逻辑
 */

import {
  FRED_INDICATORS,
  getFREDData,
  determineRiskLevel,
  RISK_DESCRIPTIONS,
} from "./fredClient";
import { InsertIndicatorHistory } from "../drizzle/schema";
import {
  getIndicatorByType,
  upsertIndicator,
  addHistoryRecord,
  upsertHistoryRecord,
  logDataUpdate,
} from "./indicatorDb";
import { InsertLiquidityIndicator } from "../drizzle/schema";
import { fetchLatestCMEPreciousMetals } from "./goldFuturesClient";
import { fetchVIX, fetchVIXHistory, fetchMOVE, fetchCDS, fetchCDSHistory } from "./riskIndicatorsClient";
import { memoryCache } from "./memoryCache";

// 真实的 FRED 指标（不包含黄金期货，因为黄金期货来自 CME）
const FRED_INDICATOR_TYPES = [
  "ONRRP",
  "OBFR",
  "SOFR",
  "SOFRVOL",
  "T10Y2Y",
  "DISCOUNT_WINDOW",
  "CENTRAL_BANK_SWAPS",
  "RESERVE_BALANCES",
  "SRF",
];

/**
 * 获取单个 FRED 指标的最新数据并更新数据库
 */
export async function fetchAndUpdateIndicator(
  indicatorType: string,
  apiKey: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const config = FRED_INDICATORS[indicatorType as keyof typeof FRED_INDICATORS];
    if (!config) {
      throw new Error(`Unknown indicator type: ${indicatorType}`);
    }

    // 从 FRED API 获取数据（已按 desc 排序，最新在前，过滤掉 "." 缺失值）
    const observations = await getFREDData(config.seriesId, apiKey);

    if (!observations || observations.length === 0) {
      throw new Error(`No data returned from FRED for ${config.seriesId}`);
    }

    const latest = observations[0];
    const previous = observations.length > 1 ? observations[1] : undefined;

    if (!latest) {
      throw new Error(`No latest observation found for ${config.seriesId}`);
    }

    // 计算变化
    const currentVal = parseFloat(latest.value);
    const previousVal = previous ? parseFloat(previous.value) : undefined;
    let change = 0;
    let changePercent = 0;

    if (previousVal !== undefined && !isNaN(previousVal) && previousVal !== 0) {
      change = currentVal - previousVal;
      changePercent = (change / Math.abs(previousVal)) * 100;
    }

    // 确定风险级别
    const riskLevel = determineRiskLevel(indicatorType, currentVal, previousVal);

    // 生成风险描述
    const riskDescription = RISK_DESCRIPTIONS[indicatorType] || "正常状态";

    // 准备数据库记录
    const indicatorData: InsertLiquidityIndicator = {
      indicatorType,
      fredSeriesId: config.seriesId,
      observationDate: latest.date,
      currentValue: latest.value,
      previousValue: previous?.value || null,
      changeValue: String(change),
      changePercent: String(changePercent),
      unit: config.unit,
      frequency: config.frequency,
      riskLevel,
      riskDescription,
      dataSource: "FRED",
    };

    // 保存最新指标到数据库
    await upsertIndicator(indicatorData);

    // 存储最近 6 条历史观测值（按 observationDate 去重）
    const recentObs = observations.slice(0, 6);
    for (const obs of recentObs) {
      if (obs.value === ".") continue;
      await upsertHistoryRecord({
        indicatorType,
        observationDate: obs.date,
        value: obs.value,
        unit: config.unit,
      });
    }

    await logDataUpdate({
      indicatorType,
      status: "success",
      errorMessage: null,
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logDataUpdate({
      indicatorType,
      status: "error",
      errorMessage,
    });
    return { success: false, error: errorMessage };
  }
}

/**
 * 获取所有 FRED 指标的最新数据
 */
export async function fetchAllIndicators(
  apiKey: string
): Promise<{ successful: number; failed: number }> {
  let successful = 0;
  let failed = 0;

  for (const indicatorType of FRED_INDICATOR_TYPES) {
    const result = await fetchAndUpdateIndicator(indicatorType, apiKey);
    if (result.success) {
      successful++;
      console.log(`[DataFetcher] Successfully updated ${indicatorType}`);
    } else {
      failed++;
      console.error(`[DataFetcher] Failed to update ${indicatorType}: ${result.error}`);
    }
  }

  // 同时更新黄金期货指标
  const goldResult = await fetchGoldFuturesIndicators();
  successful += goldResult.successful;
  failed += goldResult.failed;

  // 更新风险指标（VIX、MOVE）
  const riskResult = await fetchRiskIndicators(apiKey);
  successful += riskResult.successful;
  failed += riskResult.failed;

  return { successful, failed };
}

/**
 * 从 CME Daily Bulletin 获取最新黄金、白银期货指标。
 */
export async function fetchGoldFuturesIndicators(): Promise<{
  successful: number;
  failed: number;
}> {
  try {
    console.log("[DataFetcher] Fetching latest CME precious-metals bulletin...");
    const snapshot = await fetchLatestCMEPreciousMetals();
    const indicators = [
      { prefix: "GOLD", metrics: snapshot.gold, deliveryUnit: "1 Unit = 100 Ounce" },
      { prefix: "SILVER", metrics: snapshot.silver, deliveryUnit: "1 Unit = 5000 Ounce" },
    ].flatMap(({ prefix, metrics, deliveryUnit }) => [
      { type: `${prefix}_EFP`, value: metrics.efp, unit: "合约数", date: metrics.date },
      { type: `${prefix}_EFR`, value: metrics.efr, unit: "合约数", date: metrics.date },
      { type: `${prefix}_TAS`, value: metrics.tas, unit: "合约数", date: metrics.date },
      { type: `${prefix}_DELIVERIES`, value: metrics.deliveries, unit: deliveryUnit, date: metrics.date },
    ]);

    let successful = 0;
    let failed = 0;

    for (const indicator of indicators) {
      try {
        const currentVal = indicator.value;
        const existing = await getIndicatorByType(indicator.type);
        const previousVal = existing
          ? existing.observationDate !== indicator.date
            ? Number(existing.currentValue)
            : existing.previousValue === null
              ? undefined
              : Number(existing.previousValue)
          : undefined;
        let change = 0;
        let changePercent = 0;

        if (previousVal !== undefined && previousVal !== 0) {
          change = currentVal - previousVal;
          changePercent = (change / Math.abs(previousVal)) * 100;
        }

        const riskLevel = determineRiskLevel(indicator.type, currentVal, previousVal);
        const riskDescription = RISK_DESCRIPTIONS[indicator.type] || "正常状态";

        const indicatorData: InsertLiquidityIndicator = {
          indicatorType: indicator.type,
          fredSeriesId: null,
          observationDate: indicator.date,
          currentValue: String(currentVal),
          previousValue: previousVal !== undefined && Number.isFinite(previousVal) ? String(previousVal) : null,
          changeValue: String(change),
          changePercent: String(changePercent),
          unit: indicator.unit,
          frequency: "daily",
          riskLevel,
          riskDescription,
          dataSource: "CME",
        };

        await upsertIndicator(indicatorData);

        await upsertHistoryRecord({
          indicatorType: indicator.type,
          observationDate: indicator.date,
          value: String(currentVal),
          unit: indicator.unit,
        });

        console.log(`[DataFetcher] Updated ${indicator.type}: ${currentVal} (change: ${change})`);
        successful++;
      } catch (err) {
        console.error(`[DataFetcher] Failed to update ${indicator.type}:`, err);
        failed++;
      }
    }

    return { successful, failed };
  } catch (error) {
    console.error("[DataFetcher] Error fetching CME precious metals:", error);
    return { successful: 0, failed: 8 };
  }
}

/**
 * 手动触发数据刷新
 */
export async function manualRefreshIndicators(apiKey: string) {
  console.log("[DataFetcher] Manual refresh triggered");
  return fetchAllIndicators(apiKey);
}

/**
 * 设置定时刷新任务（启动时立即刷新，此后每 12 小时刷新一次）
 */
export function scheduleDataRefresh(apiKey: string) {
  const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000; // 每天两次

  console.log("[DataFetcher] Scheduling data refresh every 12 hours...");

  // 立即执行一次初始化
  fetchAllIndicators(apiKey)
    .then(({ successful, failed }) => {
      console.log(
        `[DataFetcher] Initial fetch complete: ${successful} successful, ${failed} failed`
      );
    })
    .catch((err) => {
      console.error("[DataFetcher] Initial fetch failed:", err);
    });

  // 每 12 小时刷新一次
  setInterval(() => {
    fetchAllIndicators(apiKey)
      .then(({ successful, failed }) => {
        console.log(
          `[DataFetcher] Scheduled refresh complete: ${successful} successful, ${failed} failed`
        );
      })
      .catch((err) => {
        console.error("[DataFetcher] Scheduled refresh failed:", err);
      });
  }, REFRESH_INTERVAL_MS);
}

/** Keep CME metals updating even when the optional FRED key is unavailable. */
export function scheduleCMEDataRefresh() {
  const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
  const refresh = () =>
    fetchGoldFuturesIndicators()
      .then(({ successful, failed }) => {
        console.log(`[DataFetcher] CME bulletin refresh complete: ${successful} successful, ${failed} failed`);
      })
      .catch((err) => console.error("[DataFetcher] CME bulletin refresh failed:", err));

  console.log("[DataFetcher] Scheduling CME bulletin refresh every 12 hours...");
  void refresh();
  setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
}

/**
 * 获取风险指标（VIX 来自 FRED，MOVE 来自 Yahoo Finance）
 * US 5Y CDS 通过前端 iframe 代理获取，不在此处处理
 */
export async function fetchRiskIndicators(
  apiKey: string
): Promise<{ successful: number; failed: number }> {
  let successful = 0;
  let failed = 0;

  // ── VIX（FRED VIXCLS）──────────────────────────────────────────────────────
  try {
    console.log("[DataFetcher] Fetching VIX from FRED...");
    const vixData = await fetchVIX(apiKey);
    if (!vixData) throw new Error("No VIX data returned");

    const currentVal = parseFloat(vixData.value);
    const previousVal = vixData.previousValue
      ? parseFloat(vixData.previousValue)
      : undefined;
    let change = 0;
    let changePercent = 0;
    if (previousVal !== undefined && !isNaN(previousVal) && previousVal !== 0) {
      change = currentVal - previousVal;
      changePercent = (change / Math.abs(previousVal)) * 100;
    }

    const { determineRiskLevel, RISK_DESCRIPTIONS } = await import("./fredClient");

    const vixIndicatorData: InsertLiquidityIndicator = {
      indicatorType: "VIX",
      fredSeriesId: "VIXCLS",
      observationDate: vixData.date,
      currentValue: vixData.value,
      previousValue: vixData.previousValue ?? null,
      changeValue: String(change),
      changePercent: String(changePercent),
      unit: "点",
      frequency: "daily",
      riskLevel: determineRiskLevel("VIX", currentVal, previousVal),
      riskDescription: RISK_DESCRIPTIONS["VIX"] || "正常状态",
      dataSource: "FRED",
    };

    // 保存到内存缓存（数据库不可用时的备用）
    memoryCache.set("VIX", {
      ...vixIndicatorData,
      id: "VIX",
      lastUpdatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    await upsertIndicator(vixIndicatorData);

    // 存储历史记录
    const vixHistory = await fetchVIXHistory(apiKey, 6);
    for (const rec of vixHistory) {
      await upsertHistoryRecord({
        indicatorType: "VIX",
        observationDate: rec.date,
        value: rec.value,
        unit: "点",
      });
    }

    await logDataUpdate({ indicatorType: "VIX", status: "success", errorMessage: null });
    console.log(`[DataFetcher] VIX updated: ${vixData.value} (${vixData.date})`);
    successful++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[DataFetcher] VIX fetch failed:", msg);
    await logDataUpdate({ indicatorType: "VIX", status: "error", errorMessage: msg });
    failed++;
  }

  // ── MOVE（Yahoo Finance ^MOVE）────────────────────────────────────────────
  try {
    console.log("[DataFetcher] Fetching MOVE from Yahoo Finance...");
    const moveData = await fetchMOVE();
    if (!moveData) throw new Error("No MOVE data returned");

    const currentVal = parseFloat(moveData.value);
    const previousVal = moveData.previousValue
      ? parseFloat(moveData.previousValue)
      : undefined;
    let change = 0;
    let changePercent = 0;
    if (previousVal !== undefined && !isNaN(previousVal) && previousVal !== 0) {
      change = currentVal - previousVal;
      changePercent = (change / Math.abs(previousVal)) * 100;
    }

    const { determineRiskLevel, RISK_DESCRIPTIONS } = await import("./fredClient");

    const moveIndicatorData: InsertLiquidityIndicator = {
      indicatorType: "MOVE",
      fredSeriesId: null,
      observationDate: moveData.date,
      currentValue: moveData.value,
      previousValue: moveData.previousValue ?? null,
      changeValue: String(change),
      changePercent: String(changePercent),
      unit: "bps",
      frequency: "daily",
      riskLevel: determineRiskLevel("MOVE", currentVal, previousVal),
      riskDescription: RISK_DESCRIPTIONS["MOVE"] || "正常状态",
      dataSource: "Yahoo Finance",
    };

    // 保存到内存缓存（数据库不可用时的备用）
    memoryCache.set("MOVE", {
      ...moveIndicatorData,
      id: "MOVE",
      lastUpdatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    await upsertIndicator(moveIndicatorData);

    // MOVE 只需当前值，不再存储历史记录

    await logDataUpdate({ indicatorType: "MOVE", status: "success", errorMessage: null });
    console.log(`[DataFetcher] MOVE updated: ${moveData.value} (${moveData.date})`);
    successful++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[DataFetcher] MOVE fetch failed:", msg);
    await logDataUpdate({ indicatorType: "MOVE", status: "error", errorMessage: msg });
    failed++;
  }

  // ── US 5Y CDS（worldgovernmentbonds.com WordPress REST API）──────────────
  try {
    console.log("[DataFetcher] Fetching US 5Y CDS from worldgovernmentbonds.com...");
    const cdsData = await fetchCDS();
    if (!cdsData) throw new Error("No CDS data returned");

    const currentVal = parseFloat(cdsData.value);
    const previousVal = cdsData.previousValue
      ? parseFloat(cdsData.previousValue)
      : undefined;
    let change = 0;
    let changePercent = 0;
    if (previousVal !== undefined && !isNaN(previousVal) && previousVal !== 0) {
      change = currentVal - previousVal;
      changePercent = (change / Math.abs(previousVal)) * 100;
    }

    const { determineRiskLevel: drl, RISK_DESCRIPTIONS: rd } = await import("./fredClient");

    const cdsIndicatorData: InsertLiquidityIndicator = {
      indicatorType: "US_CDS_5Y",
      fredSeriesId: null,
      observationDate: cdsData.date,
      currentValue: cdsData.value,
      previousValue: cdsData.previousValue ?? null,
      changeValue: String(change),
      changePercent: String(changePercent),
      unit: "bps",
      frequency: "daily",
      riskLevel: drl("US_CDS_5Y", currentVal, previousVal),
      riskDescription: rd["US_CDS_5Y"] || "美国主权信用违约互换",
      dataSource: "worldgovernmentbonds.com",
    };

    // 保存到内存缓存（数据库不可用时的备用）
    memoryCache.set("US_CDS_5Y", {
      ...cdsIndicatorData,
      id: "US_CDS_5Y",
      lastUpdatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    await upsertIndicator(cdsIndicatorData);

    const cdsHistory = await fetchCDSHistory(6);
    for (const rec of cdsHistory) {
      await upsertHistoryRecord({
        indicatorType: "US_CDS_5Y",
        observationDate: rec.date,
        value: rec.value,
        unit: "bps",
      });
    }

    await logDataUpdate({ indicatorType: "US_CDS_5Y", status: "success", errorMessage: null });
    console.log(`[DataFetcher] US_CDS_5Y updated: ${cdsData.value} (${cdsData.date})`);
    successful++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[DataFetcher] US_CDS_5Y fetch failed:", msg);
    await logDataUpdate({ indicatorType: "US_CDS_5Y", status: "error", errorMessage: msg });
    failed++;
  }

  return { successful, failed };
}
