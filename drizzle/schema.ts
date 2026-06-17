import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * 流动性指标数据表
 * 存储来自 FRED 和其他来源的流动性指标最新数据
 */
export const liquidityIndicators = mysqlTable("liquidity_indicators", {
  id: int("id").autoincrement().primaryKey(),
  // 指标类型：ONRRP, OBFR, SOFR, SOFRVOL, T10Y2Y, DISCOUNT_WINDOW, CENTRAL_BANK_SWAPS, RESERVE_BALANCES, SRF, GOLD_FUTURES
  indicatorType: varchar("indicatorType", { length: 64 }).notNull().unique(),
  // FRED 序列 ID（如果适用）
  fredSeriesId: varchar("fredSeriesId", { length: 64 }),
  // 观察日期 (YYYY-MM-DD)
  observationDate: varchar("observationDate", { length: 10 }).notNull(),
  // 当前值（存储为字符串以支持不同精度）
  currentValue: varchar("currentValue", { length: 255 }).notNull(),
  // 前一期值（用于计算变化）
  previousValue: varchar("previousValue", { length: 255 }),
  // 变化值（currentValue - previousValue）
  changeValue: varchar("changeValue", { length: 255 }),
  // 变化百分比
  changePercent: varchar("changePercent", { length: 255 }),
  // 单位（如 %, 百万美元, 合约数等）
  unit: varchar("unit", { length: 64 }).notNull(),
  // 数据频率：daily, weekly
  frequency: varchar("frequency", { length: 32 }).notNull(),
  // 风险预警级别：normal, caution, warning
  riskLevel: mysqlEnum("riskLevel", ["normal", "caution", "warning"]).default("normal").notNull(),
  // 预警说明文本
  riskDescription: text("riskDescription"),
  // 数据来源：FRED, CME, NY_FED 等
  dataSource: varchar("dataSource", { length: 64 }).notNull(),
  // 最后更新时间
  lastUpdatedAt: timestamp("lastUpdatedAt").defaultNow().onUpdateNow().notNull(),
  // 创建时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LiquidityIndicator = typeof liquidityIndicators.$inferSelect;
export type InsertLiquidityIndicator = typeof liquidityIndicators.$inferInsert;

/**
 * 指标历史数据表
 * 存储指标的历史趋势数据（用于图表展示）
 */
export const indicatorHistory = mysqlTable("indicator_history", {
  id: int("id").autoincrement().primaryKey(),
  // 指标类型
  indicatorType: varchar("indicatorType", { length: 64 }).notNull(),
  // 观察日期 (YYYY-MM-DD)
  observationDate: varchar("observationDate", { length: 10 }).notNull(),
  // 数值
  value: varchar("value", { length: 255 }).notNull(),
  // 单位
  unit: varchar("unit", { length: 64 }).notNull(),
  // 创建时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type IndicatorHistory = typeof indicatorHistory.$inferSelect;
export type InsertIndicatorHistory = typeof indicatorHistory.$inferInsert;

/**
 * 数据更新日志表
 * 记录每次数据刷新的情况
 */
export const dataUpdateLog = mysqlTable("data_update_log", {
  id: int("id").autoincrement().primaryKey(),
  // 指标类型
  indicatorType: varchar("indicatorType", { length: 64 }).notNull(),
  // 更新状态：success, failed, partial
  status: varchar("status", { length: 32 }).notNull(),
  // 错误信息（如果有）
  errorMessage: text("errorMessage"),
  // 更新的记录数
  recordsUpdated: int("recordsUpdated").default(0),
  // 更新时间
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type DataUpdateLog = typeof dataUpdateLog.$inferSelect;
export type InsertDataUpdateLog = typeof dataUpdateLog.$inferInsert;
