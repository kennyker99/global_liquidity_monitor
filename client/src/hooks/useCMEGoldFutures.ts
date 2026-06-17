/**
 * 前端直接调用 CME API 获取贵金属期货数据
 * CME 产品 ID 437 = 黄金期货 (GC/COMEX)
 * CME 产品 ID 458 = 白银期货 (SI/COMEX)  [通过拦截 silver.volume.html 网络请求确认]
 *   (注：84 是旧的/错误的 ID，会返回 empty:true)
 */

import { useState, useEffect } from "react";

export interface CMEGoldDayData {
  date: string; // YYYY-MM-DD
  efp: number;
  efr: number;
  tas: number;
  deliveries: number;
}

export interface CMESilverDayData {
  date: string; // YYYY-MM-DD
  efp: number;
  efr: number;
  tas: number;
  deliveries: number;
}

export interface CMEGoldFuturesState {
  history: CMEGoldDayData[]; // 最近 6 个交易日，升序
  latest: CMEGoldDayData | null;
  previous: CMEGoldDayData | null;
  isLoading: boolean;
  error: string | null;
  lastFetched: Date | null;
}

export interface CMESilverFuturesState {
  history: CMESilverDayData[];
  latest: CMESilverDayData | null;
  previous: CMESilverDayData | null;
  isLoading: boolean;
  error: string | null;
}

function parseIntSafe(val: string | undefined): number {
  if (!val || val === "-") return 0;
  return parseInt(val.replace(/,/g, ""), 10) || 0;
}

function formatDateYYYYMMDD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function toISODate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

/** 生成最近 N 个工作日（从昨天往前） */
function getRecentWeekdays(n: number): string[] {
  const days: string[] = [];
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - 1);
  while (days.length < n) {
    if (isWeekday(cursor)) {
      days.push(formatDateYYYYMMDD(new Date(cursor)));
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return days;
}

/** 获取黄金期货单日数据 */
async function fetchCMEGoldForDate(dateStr: string): Promise<CMEGoldDayData | null> {
  try {
    const url = `https://www.cmegroup.com/CmeWS/mvc/Volume/Details/F/437/${dateStr}/P?tradeDate=${dateStr}&pageSize=500&isProtected&_t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.empty || !data.totals) return null;
    const t = data.totals;
    const efp = parseIntSafe(t.efpVol);
    const efr = parseIntSafe(t.efrVol);
    const tas = parseIntSafe(t.tasVol);
    const deliveries = parseIntSafe(t.deliveries);
    if (efp === 0 && efr === 0 && tas === 0 && deliveries === 0) return null;
    return { date: toISODate(dateStr), efp, efr, tas, deliveries };
  } catch {
    return null;
  }
}

/** 获取白银期货单日数据（EFP/EFR/TAS/Deliveries） */
async function fetchCMESilverForDate(dateStr: string): Promise<CMESilverDayData | null> {
  try {
    const url = `https://www.cmegroup.com/CmeWS/mvc/Volume/Details/F/458/${dateStr}/P?tradeDate=${dateStr}&pageSize=500&isProtected&_t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.empty || !data.totals) return null;
    const t = data.totals;
    const efp = parseIntSafe(t.efpVol);
    const efr = parseIntSafe(t.efrVol);
    const tas = parseIntSafe(t.tasVol);
    const deliveries = parseIntSafe(t.deliveries);
    // totals 存在即记录（即使全为 0）
    return { date: toISODate(dateStr), efp, efr, tas, deliveries };
  } catch {
    return null;
  }
}

/** 黄金期货 Hook */
export function useCMEGoldFutures(): CMEGoldFuturesState {
  const [state, setState] = useState<CMEGoldFuturesState>({
    history: [],
    latest: null,
    previous: null,
    isLoading: true,
    error: null,
    lastFetched: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      setState((s) => ({ ...s, isLoading: true, error: null }));
      try {
        const candidates = getRecentWeekdays(12);
        const results: CMEGoldDayData[] = [];

        for (const dateStr of candidates) {
          if (results.length >= 6) break;
          const record = await fetchCMEGoldForDate(dateStr);
          if (record) results.push(record);
          await new Promise((r) => setTimeout(r, 150));
        }

        if (cancelled) return;

        results.sort((a, b) => a.date.localeCompare(b.date));
        const latest = results.length > 0 ? results[results.length - 1]! : null;
        const previous = results.length > 1 ? results[results.length - 2]! : null;

        setState({
          history: results,
          latest,
          previous,
          isLoading: false,
          error: results.length === 0 ? "暂无 CME 黄金数据" : null,
          lastFetched: new Date(),
        });
      } catch (err) {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            isLoading: false,
            error: err instanceof Error ? err.message : "获取 CME 黄金数据失败",
          }));
        }
      }
    }

    fetchAll();
    return () => { cancelled = true; };
  }, []);

  return state;
}

/** 白银期货 Hook */
export function useCMESilverFutures(): CMESilverFuturesState {
  const [state, setState] = useState<CMESilverFuturesState>({
    history: [],
    latest: null,
    previous: null,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      setState((s) => ({ ...s, isLoading: true, error: null }));
      try {
        const candidates = getRecentWeekdays(12);
        const results: CMESilverDayData[] = [];

        for (const dateStr of candidates) {
          if (results.length >= 6) break;
          const record = await fetchCMESilverForDate(dateStr);
          if (record !== null) results.push(record);
          await new Promise((r) => setTimeout(r, 150));
        }

        if (cancelled) return;

        results.sort((a, b) => a.date.localeCompare(b.date));
        const latest = results.length > 0 ? results[results.length - 1]! : null;
        const previous = results.length > 1 ? results[results.length - 2]! : null;

        setState({
          history: results,
          latest,
          previous,
          isLoading: false,
          error: results.length === 0 ? "暂无 CME 白银数据" : null,
        });
      } catch (err) {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            isLoading: false,
            error: err instanceof Error ? err.message : "获取 CME 白银数据失败",
          }));
        }
      }
    }

    fetchAll();
    return () => { cancelled = true; };
  }, []);

  return state;
}

/** 从 CME 历史数据中构建单个指标的历史记录（供 StaticHistoryTimeline 使用） */
export function buildGoldIndicatorHistory(
  history: CMEGoldDayData[],
  field: "efp" | "efr" | "tas" | "deliveries",
  unit: string
) {
  return history.map((d) => ({
    observationDate: d.date,
    value: String(d[field]),
    unit,
  }));
}

export function buildSilverIndicatorHistory(
  history: CMESilverDayData[],
  field: "efp" | "efr" | "tas" | "deliveries",
  unit: string
) {
  return history.map((d) => ({
    observationDate: d.date,
    value: String(d[field]),
    unit,
  }));
}
