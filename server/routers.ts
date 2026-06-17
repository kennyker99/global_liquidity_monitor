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
import { fetchAllIndicators, fetchGoldFuturesIndicators, fetchRiskIndicators } from "./dataFetcher";
import { fetchCDSProxyHtml, fetchMOVEQuote, type MOVEQuote } from "./riskIndicatorsClient";
import { memoryCache } from "./memoryCache";
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

    // 获取 MOVE Index（服务端抓 Yahoo Finance，避开前端 CORS）
    // 返回统一格式：{ symbol, name, price, change, changePercent, updatedAt }
    getMOVE: publicProcedure.query(async (): Promise<MOVEQuote | null> => {
      console.log("[Router][getMOVE] 收到请求，开始服务端抓取 MOVE...");
      // 1) 先尝试实时抓取
      const live = await fetchMOVEQuote();
      if (live) {
        // 写入内存缓存，供后续回退
        memoryCache.set("MOVE", {
          indicatorType: "MOVE",
          id: "MOVE",
          currentValue: String(live.price),
          previousValue: live.change !== null ? String(live.price - live.change) : null,
          changeValue: live.change !== null ? String(live.change) : "0",
          changePercent: live.changePercent !== null ? String(live.changePercent) : "0",
          unit: "bps",
          observationDate: live.updatedAt,
          riskLevel:
            live.price > 120 ? "warning" : live.price > 80 ? "caution" : "normal",
          riskDescription: "衡量美国国债市场隐含波动率，低于80正常，超过120高度紧张",
          dataSource: "Yahoo Finance",
          lastUpdatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        });
        console.log("[Router][getMOVE] 实时抓取成功，返回:", JSON.stringify(live));
        return live;
      }

      // 2) 实时失败 → 回退到内存缓存
      const cached = memoryCache.get("MOVE");
      if (cached && cached.currentValue) {
        const price = parseFloat(String(cached.currentValue));
        const changeValue = cached.changeValue ? parseFloat(String(cached.changeValue)) : null;
        const changePercent = cached.changePercent ? parseFloat(String(cached.changePercent)) : null;
        const fallback: MOVEQuote = {
          symbol: "^MOVE",
          name: "MOVE Index",
          price,
          change: changeValue && changeValue !== 0 ? changeValue : null,
          changePercent: changePercent && changePercent !== 0 ? changePercent : null,
          updatedAt: String(cached.observationDate ?? cached.lastUpdatedAt ?? ""),
        };
        console.log("[Router][getMOVE] 实时失败，使用内存缓存回退:", JSON.stringify(fallback));
        return fallback;
      }

      console.error("[Router][getMOVE] 实时和缓存都没有 MOVE 数据，返回 null");
      return null;
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
