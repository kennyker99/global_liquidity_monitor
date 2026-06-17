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
  upsertIndicator,
  addHistoryRecord,
  upsertHistoryRecord,
  logDataUpdate,
} from "./indicatorDb";
import { InsertLiquidityIndicator } from "../drizzle/schema";
import { getLatestGoldFuturesMetrics, getGoldFuturesHistory } from "./goldFuturesClient";
import { fetchVIX, fetchVIXHistory, fetchMOVE, fetchMOVEHistory, fetchCDS, fetchCDSHistory } from "./riskIndicatorsClient";

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
 * 获取黄金期货指标（来自 CME，非 FRED）
 * 抓取最近 6 个交易日数据，存储历史记录，并计算变化量
 */
export async function fetchGoldFuturesIndicators(): Promise<{
  successful: number;
  failed: number;
}> {
  try {
    console.log("[DataFetcher] Fetching CME gold futures data...");
    // 获取最近 6 个交易日的历史数据
    const history = await getGoldFuturesHistory(6);

    if (!history || history.length === 0) {
      console.error("[DataFetcher] No CME gold futures data available");
      return { successful: 0, failed: 4 };
    }

    const latest = history[history.length - 1]!;
    const previous = history.length > 1 ? history[history.length - 2] : null;

    const goldIndicators = [
      {
        type: "GOLD_EFP",
        value: latest.efp,
        previousValue: previous?.efp,
        unit: "合约数",
      },
      {
        type: "GOLD_EFR",
        value: latest.efr,
        previousValue: previous?.efr,
        unit: "合约数",
      },
      {
        type: "GOLD_TAS",
        value: latest.tas,
        previousValue: previous?.tas,
        unit: "合约数",
      },
      {
        type: "GOLD_DELIVERIES",
        value: latest.deliveries,
        previousValue: previous?.deliveries,
        unit: "1 Unit = 100 Ounce",
      },
    ];

    let successful = 0;
    let failed = 0;

    for (const indicator of goldIndicators) {
      try {
        const currentVal = indicator.value;
        const previousVal = indicator.previousValue;
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
          observationDate: latest.date,
          currentValue: String(currentVal),
          previousValue: previousVal !== undefined ? String(previousVal) : null,
          changeValue: String(change),
          changePercent: String(changePercent),
          unit: indicator.unit,
          frequency: "daily",
          riskLevel,
          riskDescription,
          dataSource: "CME",
        };

        await upsertIndicator(indicatorData);

        // 存储所有历史记录（去重）
        for (const record of history) {
          await upsertHistoryRecord({
            indicatorType: indicator.type,
            observationDate: record.date,
            value: String(
              indicator.type === "GOLD_EFP" ? record.efp :
              indicator.type === "GOLD_EFR" ? record.efr :
              indicator.type === "GOLD_TAS" ? record.tas :
              record.deliveries
            ),
            unit: indicator.unit,
          });
        }

        console.log(`[DataFetcher] Updated ${indicator.type}: ${currentVal} (change: ${change})`);
        successful++;
      } catch (err) {
        console.error(`[DataFetcher] Failed to update ${indicator.type}:`, err);
        failed++;
      }
    }

    return { successful, failed };
  } catch (error) {
    console.error("[DataFetcher] Error fetching gold futures:", error);
    return { successful: 0, failed: 4 };
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
 * 设置定时刷新任务（每天 UTC 18:00 = 美东时间 2PM）
 */
export function scheduleDataRefresh(apiKey: string) {
  const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 小时

  console.log("[DataFetcher] Scheduling daily data refresh...");

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

  // 每 24 小时刷新一次
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

    await upsertIndicator({
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
    });

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

    await upsertIndicator({
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
    });

    // 存储历史记录
    const moveHistory = await fetchMOVEHistory(6);
    for (const rec of moveHistory) {
      await upsertHistoryRecord({
        indicatorType: "MOVE",
        observationDate: rec.date,
        value: rec.value,
        unit: "bps",
      });
    }

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

    await upsertIndicator({
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
    });

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
