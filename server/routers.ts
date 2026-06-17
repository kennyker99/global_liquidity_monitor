import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  getAllLatestIndicators,
  getIndicatorByType,
  getIndicatorHistory,
  getHistoryByDateRange,
  getRecentHistoryRecords,
} from "./indicatorDb";
import { fetchAllIndicators, fetchGoldFuturesIndicators, fetchRiskIndicators, memoryCache } from "./dataFetcher";
import { fetchCDSProxyHtml } from "./riskIndicatorsClient";
import { upsertIndicator, upsertHistoryRecord, logDataUpdate } from "./indicatorDb";
import { determineRiskLevel, RISK_DESCRIPTIONS } from "./fredClient";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  indicators: router({
    // 获取所有最新指标
    getAll: publicProcedure.query(async () => {
      const dbData = await getAllLatestIndicators();
      // If DB has data, return it; otherwise return in-memory cache
      if (dbData && dbData.length > 0) return dbData;
      return Array.from(memoryCache.values());
    }),

    // 获取特定指标
    getByType: publicProcedure
      .input(z.object({ indicatorType: z.string() }))
      .query(async ({ input }) => {
        return await getIndicatorByType(input.indicatorType);
      }),

    // 获取指标历史数据（用于图表）
    getHistory: publicProcedure
      .input(
        z.object({
          indicatorType: z.string(),
          limit: z.number().optional().default(100),
        })
      )
      .query(async ({ input }) => {
        return await getIndicatorHistory(input.indicatorType, input.limit);
      }),

    // 获取指定日期范围的历史数据
    getHistoryByDateRange: publicProcedure
      .input(
        z.object({
          indicatorType: z.string(),
          startDate: z.string(), // YYYY-MM-DD
          endDate: z.string(), // YYYY-MM-DD
        })
      )
      .query(async ({ input }) => {
        return await getHistoryByDateRange(
          input.indicatorType,
          input.startDate,
          input.endDate
        );
      }),

    // 获取指标的最近 N 条历史记录（用于过往记录展示）
    getRecentHistory: publicProcedure
      .input(
        z.object({
          indicatorType: z.string(),
          limit: z.number().optional().default(6),
        })
      )
      .query(async ({ input }) => {
        return await getRecentHistoryRecords(input.indicatorType, input.limit);
      }),

    // CDS 代理接口：返回 worldgovernmentbonds.com 的 HTML
    getCDSProxy: publicProcedure.query(async () => {
      const html = await fetchCDSProxyHtml();
      return { html: html || "" };
    }),

    // 手动更新 US_CDS_5Y（由前端解析到数值后调用）
    updateCDS: publicProcedure
      .input(z.object({
        value: z.string(),
        date: z.string(),
        previousValue: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const currentVal = parseFloat(input.value);
        const previousVal = input.previousValue ? parseFloat(input.previousValue) : undefined;
        let change = 0;
        let changePercent = 0;
        if (previousVal !== undefined && !isNaN(previousVal) && previousVal !== 0) {
          change = currentVal - previousVal;
          changePercent = (change / Math.abs(previousVal)) * 100;
        }
        await upsertIndicator({
          indicatorType: "US_CDS_5Y",
          fredSeriesId: null,
          observationDate: input.date,
          currentValue: input.value,
          previousValue: input.previousValue ?? null,
          changeValue: String(change),
          changePercent: String(changePercent),
          unit: "bps",
          frequency: "daily",
          riskLevel: determineRiskLevel("US_CDS_5Y", currentVal, previousVal),
          riskDescription: RISK_DESCRIPTIONS["US_CDS_5Y"] || "正常状态",
          dataSource: "worldgovernmentbonds.com",
        });
        await upsertHistoryRecord({
          indicatorType: "US_CDS_5Y",
          observationDate: input.date,
          value: input.value,
          unit: "bps",
        });
        await logDataUpdate({ indicatorType: "US_CDS_5Y", status: "success", errorMessage: null });
        return { success: true };
      }),

    // 手动刷新指标数据
    refresh: publicProcedure.mutation(async () => {
      try {
        const fredApiKey = process.env.FRED_API_KEY;
        if (!fredApiKey) {
          throw new Error("FRED_API_KEY not configured");
        }
        const result = await fetchAllIndicators(fredApiKey);
        return {
          success: true,
          ...result,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: errorMessage,
          timestamp: new Date().toISOString(),
        };
      }
    }),
  }),
});

export type AppRouter = typeof appRouter;
