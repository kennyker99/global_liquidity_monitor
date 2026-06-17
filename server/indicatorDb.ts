/**
 * 流动性指标数据库操作函数
 */

import { eq } from "drizzle-orm";
import {
  liquidityIndicators,
  indicatorHistory,
  dataUpdateLog,
  InsertLiquidityIndicator,
  InsertIndicatorHistory,
  InsertDataUpdateLog,
} from "../drizzle/schema";
import { getDb } from "./db";

/**
 * 获取所有最新的流动性指标
 */
export async function getAllLatestIndicators() {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get indicators: database not available");
    return [];
  }

  try {
    const results = await db.select().from(liquidityIndicators);
    return results;
  } catch (error) {
    console.error("[Database] Failed to get all indicators:", error);
    throw error;
  }
}

/**
 * 获取特定指标的最新数据
 */
export async function getIndicatorByType(indicatorType: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get indicator: database not available");
    return null;
  }

  try {
    const results = await db
      .select()
      .from(liquidityIndicators)
      .where(eq(liquidityIndicators.indicatorType, indicatorType))
      .limit(1);

    return results.length > 0 ? results[0] : null;
  } catch (error) {
    console.error(`[Database] Failed to get indicator ${indicatorType}:`, error);
    throw error;
  }
}

/**
 * 创建或更新指标数据
 */
export async function upsertIndicator(data: InsertLiquidityIndicator) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert indicator: database not available");
    return null;
  }

  try {
    // 先尝试更新
    const existing = await db
      .select()
      .from(liquidityIndicators)
      .where(eq(liquidityIndicators.indicatorType, data.indicatorType!))
      .limit(1);

    if (existing.length > 0) {
      // 更新现有记录
      await db
        .update(liquidityIndicators)
        .set({
          ...data,
          lastUpdatedAt: new Date(),
        })
        .where(eq(liquidityIndicators.indicatorType, data.indicatorType!));

      return existing[0];
    } else {
      // 插入新记录
      await db.insert(liquidityIndicators).values(data);
      return data;
    }
  } catch (error) {
    console.error(`[Database] Failed to upsert indicator ${data.indicatorType}:`, error);
    throw error;
  }
}

/**
 * 获取指标的历史数据（用于图表）
 */
export async function getIndicatorHistory(
  indicatorType: string,
  limit: number = 100
) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get history: database not available");
    return [];
  }

  try {
    const results = await db
      .select()
      .from(indicatorHistory)
      .where(eq(indicatorHistory.indicatorType, indicatorType))
      .orderBy(indicatorHistory.createdAt)
      .limit(limit);

    return results;
  } catch (error) {
    console.error(`[Database] Failed to get history for ${indicatorType}:`, error);
    throw error;
  }
}

/**
 * 添加或更新历史数据（按 indicatorType + observationDate 去重）
 */
export async function upsertHistoryRecord(data: InsertIndicatorHistory) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert history: database not available");
    return null;
  }

  try {
    // 检查是否已存在相同日期的记录
    const existing = await db
      .select()
      .from(indicatorHistory)
      .where(
        eq(indicatorHistory.indicatorType, data.indicatorType!)
      )
      .limit(100);

    const sameDate = existing.find(
      (r) => r.observationDate === data.observationDate
    );

    if (sameDate) {
      // 更新已存在的记录
      await db
        .update(indicatorHistory)
        .set({ value: data.value!, unit: data.unit! })
        .where(eq(indicatorHistory.id, sameDate.id));
    } else {
      // 插入新记录
      await db.insert(indicatorHistory).values(data);
    }
    return data;
  } catch (error) {
    console.error("[Database] Failed to upsert history record:", error);
    throw error;
  }
}

/**
 * 添加历史数据
 */
export async function addHistoryRecord(data: InsertIndicatorHistory) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot add history: database not available");
    return null;
  }

  try {
    await db.insert(indicatorHistory).values(data);
    return data;
  } catch (error) {
    console.error("[Database] Failed to add history record:", error);
    throw error;
  }
}

/**
 * 记录数据更新日志
 */
export async function logDataUpdate(data: InsertDataUpdateLog) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot log update: database not available");
    return null;
  }

  try {
    await db.insert(dataUpdateLog).values(data);
    return data;
  } catch (error) {
    console.error("[Database] Failed to log update:", error);
    throw error;
  }
}

/**
 * 获取最近的更新日志
 */
export async function getRecentUpdateLogs(limit: number = 50) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get logs: database not available");
    return [];
  }

  try {
    const results = await db
      .select()
      .from(dataUpdateLog)
      .orderBy(dataUpdateLog.updatedAt)
      .limit(limit);

    return results;
  } catch (error) {
    console.error("[Database] Failed to get update logs:", error);
    throw error;
  }
}

/**
 * 获取指定指标的最近 N 条历史记录（用于过往记录展示）
 */
export async function getRecentHistoryRecords(
  indicatorType: string,
  limit: number = 6
) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get recent history: database not available");
    return [];
  }

  try {
    // 获取所有记录并按观测日期降序排列
    const results = await db
      .select()
      .from(indicatorHistory)
      .where(eq(indicatorHistory.indicatorType, indicatorType))
      .limit(50);

    // 按 observationDate 降序排列，取最新的 N 条
    const sorted = results
      .sort((a, b) => b.observationDate.localeCompare(a.observationDate))
      .slice(0, limit);

    return sorted;
  } catch (error) {
    console.error(`[Database] Failed to get recent history for ${indicatorType}:`, error);
    throw error;
  }
}

/**
 * 批量获取指定日期范围的历史数据
 */
export async function getHistoryByDateRange(
  indicatorType: string,
  startDate: string,
  endDate: string
) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get history by date range: database not available");
    return [];
  }

  try {
    const results = await db
      .select()
      .from(indicatorHistory)
      .where(
        eq(indicatorHistory.indicatorType, indicatorType)
      );

    // 客户端过滤日期范围（因为 Drizzle 的日期比较可能有限制）
    return results.filter((r) => {
      const date = r.observationDate;
      return date >= startDate && date <= endDate;
    });
  } catch (error) {
    console.error(
      `[Database] Failed to get history for ${indicatorType} between ${startDate} and ${endDate}:`,
      error
    );
    throw error;
  }
}
