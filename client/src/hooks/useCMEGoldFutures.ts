/** COMEX data read from the server-side CME Daily Bulletin refresh. */

import { trpc } from "@/lib/trpc";

export interface CMEGoldDayData {
  date: string;
  efp: number;
  efr: number;
  tas: number;
  deliveries: number;
}

export interface CMESilverDayData extends CMEGoldDayData {}

interface CMEFuturesState<T> {
  history: T[];
  latest: T | null;
  previous: T | null;
  isLoading: boolean;
  error: string | null;
  lastFetched?: Date | null;
}

type IndicatorRow = {
  indicatorType: string;
  currentValue: string | number | null;
  previousValue: string | number | null;
  observationDate: string | Date | null;
};

function toNumber(value: string | number | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readMetal<T extends CMEGoldDayData>(
  rows: IndicatorRow[] | undefined,
  prefix: "GOLD" | "SILVER"
): CMEFuturesState<T> {
  const types = [`${prefix}_EFP`, `${prefix}_EFR`, `${prefix}_TAS`, `${prefix}_DELIVERIES`];
  const records = types.map((type) => rows?.find((row) => row.indicatorType === type));
  const dateValues = records.map((record) => record?.observationDate).filter(Boolean);
  const date = dateValues.length
    ? String(dateValues.sort((a, b) => String(a).localeCompare(String(b))).at(-1)).slice(0, 10)
    : "";
  const current = records.map((record) => toNumber(record?.currentValue ?? null));
  const previous = records.map((record) => toNumber(record?.previousValue ?? null));
  const hasLatest = date !== "" && current.every((value) => value !== undefined);
  const latest = hasLatest
    ? ({ date, efp: current[0]!, efr: current[1]!, tas: current[2]!, deliveries: current[3]! } as T)
    : null;
  const hasPrevious = previous.every((value) => value !== undefined);
  const previousDay = hasPrevious
    ? ({ date, efp: previous[0]!, efr: previous[1]!, tas: previous[2]!, deliveries: previous[3]! } as T)
    : null;

  return {
    history: latest ? [latest] : [],
    latest,
    previous: previousDay,
    isLoading: rows === undefined,
    error: rows === undefined ? null : latest ? null : `暂无 CME ${prefix === "GOLD" ? "黄金" : "白银"}数据`,
    lastFetched: latest ? new Date() : null,
  };
}

function useCMEIndicators() {
  return trpc.indicators.getAll.useQuery(undefined, {
    refetchInterval: 60 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/** Gold metrics are now served from the Railway database, avoiding browser CORS. */
export function useCMEGoldFutures(): CMEFuturesState<CMEGoldDayData> {
  const query = useCMEIndicators();
  return readMetal<CMEGoldDayData>(query.data as IndicatorRow[] | undefined, "GOLD");
}

/** Silver metrics are now served from the Railway database, avoiding browser CORS. */
export function useCMESilverFutures(): CMEFuturesState<CMESilverDayData> {
  const query = useCMEIndicators();
  return readMetal<CMESilverDayData>(query.data as IndicatorRow[] | undefined, "SILVER");
}

/** History for the detail modal; only the latest bulletin date is retained. */
export function buildGoldIndicatorHistory(
  history: CMEGoldDayData[],
  field: "efp" | "efr" | "tas" | "deliveries",
  unit: string
) {
  return history.map((day) => ({ observationDate: day.date, value: String(day[field]), unit }));
}

export function buildSilverIndicatorHistory(
  history: CMESilverDayData[],
  field: "efp" | "efr" | "tas" | "deliveries",
  unit: string
) {
  return history.map((day) => ({ observationDate: day.date, value: String(day[field]), unit }));
}
