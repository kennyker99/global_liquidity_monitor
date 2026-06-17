import { trpc } from "@/lib/trpc";
import { CompactIndicatorCard } from "@/components/CompactIndicatorCard";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import {
  useCMEGoldFutures,
  useCMESilverFutures,
  buildGoldIndicatorHistory,
  buildSilverIndicatorHistory,
} from "@/hooks/useCMEGoldFutures";
import { useMOVE } from "@/hooks/useMOVE";

// ─── 各指标官方数据源直达链接 ────────────────────────────────────────────────
const SOURCE_URLS: Record<string, string> = {
  ONRRP:              "https://fred.stlouisfed.org/series/RRPONTSYD",
  OBFR:               "https://fred.stlouisfed.org/series/OBFR",
  SOFR:               "https://fred.stlouisfed.org/series/SOFR",
  SOFRVOL:            "https://fred.stlouisfed.org/series/SOFRVOL",
  T10Y2Y:             "https://fred.stlouisfed.org/series/T10Y2Y",
  DISCOUNT_WINDOW:    "https://fred.stlouisfed.org/series/WLCFLPCL",
  CENTRAL_BANK_SWAPS: "https://fred.stlouisfed.org/series/SWPT",
  RESERVE_BALANCES:   "https://fred.stlouisfed.org/series/WRBWFRBL",
  SRF:                "https://fred.stlouisfed.org/series/RPONTSYD",
  GOLD_EFP:           "https://www.cmegroup.com/markets/metals/precious/gold.volume.html",
  GOLD_EFR:           "https://www.cmegroup.com/markets/metals/precious/gold.volume.html",
  GOLD_TAS:           "https://www.cmegroup.com/markets/metals/precious/gold.volume.html",
  GOLD_DELIVERIES:    "https://www.cmegroup.com/markets/metals/precious/gold.volume.html",
  SILVER_EFP:         "https://www.cmegroup.com/markets/metals/precious/silver.volume.html",
  SILVER_EFR:         "https://www.cmegroup.com/markets/metals/precious/silver.volume.html",
  SILVER_TAS:         "https://www.cmegroup.com/markets/metals/precious/silver.volume.html",
  SILVER_DELIVERIES:  "https://www.cmegroup.com/markets/metals/precious/silver.volume.html",
  VIX:                "https://fred.stlouisfed.org/series/VIXCLS",
  MOVE:               "https://finance.yahoo.com/quote/%5EMOVE/",
  US_CDS_5Y:          "https://www.worldgovernmentbonds.com/cds-historical-data/united-states/5-years/",
};

// ─── 指标元数据 ──────────────────────────────────────────────────────────────
const INDICATOR_META: Record<string, { title: string; short: string; group: string }> = {
  ONRRP:              { title: "隔夜逆回购",             short: "隔夜逆回购",     group: "货币市场利率" },
  OBFR:               { title: "隔夜银行融资利率",        short: "OBFR",           group: "货币市场利率" },
  SOFR:               { title: "有担保隔夜融资利率",      short: "SOFR",           group: "货币市场利率" },
  SOFRVOL:            { title: "SOFR 成交量",             short: "SOFR VOL",       group: "货币市场利率" },
  T10Y2Y:             { title: "10-2年期国债收益率差",    short: "T10Y2Y",         group: "货币市场利率" },
  DISCOUNT_WINDOW:    { title: "贴现窗口贷款",            short: "贴现窗口",       group: "流动性工具" },
  CENTRAL_BANK_SWAPS: { title: "央行货币互换余额",        short: "央行互换",       group: "流动性工具" },
  SRF:                { title: "常备回购便利",             short: "SRF",            group: "流动性工具" },
  RESERVE_BALANCES:   { title: "美联储准备金",             short: "准备金",         group: "流动性工具" },
  VIX:                { title: "VIX 恐慌指数",              short: "VIX",            group: "风险指标" },
  MOVE:               { title: "MOVE 债券波动率指数",        short: "MOVE",           group: "风险指标" },
  US_CDS_5Y:          { title: "美国5年信用违约互换",        short: "US 5Y CDS",      group: "风险指标" },
};

const CME_RISK_DESC: Record<string, string> = {
  GOLD_EFP: "黄金期现互换量，反映实物黄金与期货价差套利活动强度",
  GOLD_EFR: "黄金风险互换量，反映市场对冲活动强度",
  GOLD_TAS: "黄金结算时交易量，反映收盘价格发现活跃度",
  GOLD_DELIVERIES: "黄金实物交割量（每合约 100 盎司），高交割量表示市场对实物黄金需求强烈",
  SILVER_EFP: "白银期现互换量，反映实物白银与期货价差套利活动强度",
  SILVER_EFR: "白银风险互换量，反映白银市场对冲活动强度",
  SILVER_TAS: "白银结算时交易量，反映白银收盘价格发现活跃度",
  SILVER_DELIVERIES: "白银实物交割量（每合约 5000 盎司），反映白银实物需求压力",
};

const GROUPS = [
  { key: "货币市场利率", label: "MONEY MARKET",    labelCN: "货币市场利率", accent: "green"  },
  { key: "流动性工具",   label: "LIQUIDITY TOOLS", labelCN: "流动性工具",   accent: "navy"   },
  { key: "黄金期货",     label: "GOLD FUTURES",    labelCN: "黄金期货",     accent: "gold"   },
  { key: "白银期货",     label: "SILVER FUTURES",  labelCN: "白银期货",     accent: "silver" },
  { key: "风险指标",     label: "RISK INDICATORS", labelCN: "风险指标",     accent: "red"    },
];

export default function Dashboard() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [now, setNow] = useState(new Date());
  const { data: indicators, isLoading, refetch } = trpc.indicators.getAll.useQuery();
  const gold = useCMEGoldFutures();
  const silver = useCMESilverFutures();
  const move = useMOVE();

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const refreshMutation = trpc.indicators.refresh.useMutation({
    onSuccess: () => {
      toast.success("数据刷新成功");
      refetch();
      setIsRefreshing(false);
    },
    onError: (err) => {
      toast.error(`刷新失败：${err.message}`);
      setIsRefreshing(false);
    },
  });

  function buildGoldCard(
    type: "GOLD_EFP" | "GOLD_EFR" | "GOLD_TAS" | "GOLD_DELIVERIES",
    field: "efp" | "efr" | "tas" | "deliveries",
    unit: string
  ) {
    const latest = gold.latest;
    const previous = gold.previous;
    const dbRecord = indicators?.find((i: any) => i.indicatorType === type);
    const useCME = !gold.isLoading && latest !== null;

    const currVal = useCME ? latest![field] : dbRecord ? parseFloat(dbRecord.currentValue) : null;
    const prevVal = useCME && previous ? previous[field] : null;

    let changeValue = "0";
    let changePercent = "0";
    if (currVal !== null && prevVal !== null) {
      const ch = currVal - prevVal;
      changeValue = ch.toFixed(0);
      changePercent = prevVal !== 0 ? ((ch / Math.abs(prevVal)) * 100).toFixed(2) : "0";
    } else if (!useCME && dbRecord) {
      changeValue = dbRecord.changeValue ?? "0";
      changePercent = dbRecord.changePercent ?? "0";
    }

    const shortLabels: Record<string, string> = {
      GOLD_EFP: "GOLD EFP", GOLD_EFR: "GOLD EFR",
      GOLD_TAS: "GOLD TAS", GOLD_DELIVERIES: "GOLD DELIVERY",
    };
    const titleLabels: Record<string, string> = {
      GOLD_EFP: "Gold Futures EFP (Exchange for Physical)",
      GOLD_EFR: "Gold Futures EFR (Exchange for Risk)",
      GOLD_TAS: "Gold Futures TAS (Trade at Settlement)",
      GOLD_DELIVERIES: "Gold Futures Deliveries",
    };

    return {
      type,
      title: titleLabels[type]!,
      short: shortLabels[type]!,
      currentValue: currVal !== null ? currVal.toLocaleString("en-US") : gold.isLoading ? "—" : "N/A",
      unit,
      changeValue: String(parseFloat(changeValue).toFixed(0)),
      changePercent: String(parseFloat(changePercent).toFixed(2)),
      riskLevel: "normal" as const,
      riskDescription: CME_RISK_DESC[type]!,
      lastUpdatedAt: useCME ? (latest?.date ?? "") : (dbRecord?.lastUpdatedAt ? String(dbRecord.lastUpdatedAt) : ""),
      history: useCME ? buildGoldIndicatorHistory(gold.history, field, unit) : undefined,
      isLoading: gold.isLoading,
    };
  }

  function buildSilverCard(
    type: "SILVER_EFP" | "SILVER_EFR" | "SILVER_TAS" | "SILVER_DELIVERIES",
    field: "efp" | "efr" | "tas" | "deliveries",
    unit: string
  ) {
    const latest = silver.latest;
    const previous = silver.previous;
    const useCME = !silver.isLoading && latest !== null;

    const currVal = useCME ? latest![field] : null;
    const prevVal = useCME && previous ? previous[field] : null;

    let changeValue = "0";
    let changePercent = "0";
    if (currVal !== null && prevVal !== null) {
      const ch = currVal - prevVal;
      changeValue = ch.toFixed(0);
      changePercent = prevVal !== 0 ? ((ch / Math.abs(prevVal)) * 100).toFixed(2) : "0";
    }

    const shortLabels: Record<string, string> = {
      SILVER_EFP: "SILVER EFP", SILVER_EFR: "SILVER EFR",
      SILVER_TAS: "SILVER TAS", SILVER_DELIVERIES: "SILVER DELIVERY",
    };
    const titleLabels: Record<string, string> = {
      SILVER_EFP: "Silver Futures EFP (Exchange for Physical)",
      SILVER_EFR: "Silver Futures EFR (Exchange for Risk)",
      SILVER_TAS: "Silver Futures TAS (Trade at Settlement)",
      SILVER_DELIVERIES: "Silver Futures Deliveries",
    };

    return {
      type,
      title: titleLabels[type]!,
      short: shortLabels[type]!,
      currentValue: currVal !== null ? currVal.toLocaleString("en-US") : silver.isLoading ? "—" : "N/A",
      unit,
      changeValue: String(parseFloat(changeValue).toFixed(0)),
      changePercent: String(parseFloat(changePercent).toFixed(2)),
      riskLevel: "normal" as const,
      riskDescription: CME_RISK_DESC[type]!,
      lastUpdatedAt: useCME ? (latest?.date ?? "") : "",
      history: useCME ? buildSilverIndicatorHistory(silver.history, field, unit) : undefined,
      isLoading: silver.isLoading,
    };
  }

  const goldCards = [
    buildGoldCard("GOLD_EFP", "efp", "contracts"),
    buildGoldCard("GOLD_EFR", "efr", "contracts"),
    buildGoldCard("GOLD_TAS", "tas", "contracts"),
    buildGoldCard("GOLD_DELIVERIES", "deliveries", "×100 oz"),
  ];

  const silverCards = [
    buildSilverCard("SILVER_EFP", "efp", "contracts"),
    buildSilverCard("SILVER_EFR", "efr", "contracts"),
    buildSilverCard("SILVER_TAS", "tas", "contracts"),
    buildSilverCard("SILVER_DELIVERIES", "deliveries", "×5000 oz"),
  ];

  const grouped: Record<string, any[]> = { 货币市场利率: [], 流动性工具: [], 风险指标: [] };
  if (indicators) {
    indicators.forEach((ind: any) => {
      if (ind.indicatorType.startsWith("GOLD_") || ind.indicatorType.startsWith("SILVER_")) return;
      const meta = INDICATOR_META[ind.indicatorType];
      if (meta && grouped[meta.group] !== undefined) grouped[meta.group].push(ind);
    });
  }

  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#F0F2F5" }}>

      {/* ─── 顶部导航栏（CME 白色导航风格）────────────────────────────────── */}
      <header className="flex-shrink-0 sticky top-0 z-40" style={{ background: "#FFFFFF", borderBottom: "1px solid #E0E5EC", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        {/* 顶部绿色细线 */}
        <div style={{ height: "3px", background: "linear-gradient(90deg, #00A651 0%, #007A3D 100%)" }} />

        <div className="flex items-center justify-between px-6 py-3">
          {/* Logo + 标题 */}
          <div className="flex items-center gap-4">
            {/* CME 风格 Logo 块 */}
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-8 h-8 rounded" style={{ background: "#0D1F3C" }}>
                <span className="text-white font-bold text-xs" style={{ fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.05em" }}>GL</span>
              </div>
              <div>
                <div className="font-bold text-sm tracking-wide uppercase" style={{ color: "#0D1F3C", fontFamily: "'Inter', sans-serif", letterSpacing: "0.08em" }}>
                  GLOBAL LIQUIDITY MONITOR
                </div>
                <div className="text-xs" style={{ color: "#7A8A9A", letterSpacing: "0.06em", fontFamily: "'IBM Plex Mono', monospace" }}>
                  REAL-TIME US LIQUIDITY DASHBOARD
                </div>
              </div>
            </div>

            {/* 分隔 */}
            <div style={{ width: "1px", height: "32px", background: "#E0E5EC" }} className="hidden lg:block mx-2" />

            {/* 数据源状态 */}
            <div className="hidden lg:flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: "#00A651" }} />
                <span className="text-xs font-semibold" style={{ color: "#5A6A7A", letterSpacing: "0.08em", fontFamily: "'IBM Plex Mono', monospace" }}>FRED API</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: "#00A651" }} />
                <span className="text-xs font-semibold" style={{ color: "#5A6A7A", letterSpacing: "0.08em", fontFamily: "'IBM Plex Mono', monospace" }}>CME COMEX</span>
              </div>
            </div>
          </div>

          {/* 右侧：时间 + 刷新 */}
          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col items-end">
              <span className="font-bold tabular-nums" style={{ color: "#0D1F3C", fontSize: "15px", fontFamily: "'IBM Plex Mono', monospace" }}>{timeStr}</span>
              <span className="text-xs" style={{ color: "#7A8A9A", fontFamily: "'IBM Plex Mono', monospace" }}>{dateStr}</span>
            </div>
            <button
              onClick={() => { setIsRefreshing(true); refreshMutation.mutateAsync(); }}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold tracking-widest uppercase rounded transition-all duration-150 disabled:opacity-60"
              style={{
                background: isRefreshing ? "#E8F5EE" : "#00A651",
                color: isRefreshing ? "#007A3D" : "#FFFFFF",
                border: "1px solid " + (isRefreshing ? "#B2DFCC" : "#007A3D"),
                fontFamily: "'IBM Plex Mono', monospace",
                letterSpacing: "0.10em",
              }}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{isRefreshing ? "REFRESHING..." : "REFRESH DATA"}</span>
            </button>
          </div>
        </div>
      </header>

      {/* ─── Hero Banner（CME 深海军蓝风格）────────────────────────────────── */}
      <div className="cme-hero px-6 py-5">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#7AAFD4", fontFamily: "'IBM Plex Mono', monospace" }}>
              US LIQUIDITY DASHBOARD
            </div>
            <h1 className="text-2xl font-bold text-white leading-tight" style={{ fontFamily: "'Inter', sans-serif", letterSpacing: "0.02em" }}>
              Global Liquidity Monitor
            </h1>
            <p className="text-sm mt-1" style={{ color: "#A8C4D8" }}>
              Federal Reserve liquidity indicators · COMEX precious metals futures data
            </p>
          </div>
          {/* 摘要数据行 */}
          <div className="flex items-center gap-6 flex-wrap">
            <HeroStat label="INDICATORS" value={indicators ? String(indicators.length + 8) : "17"} />
            <HeroStat label="DATA SOURCES" value="2" />
            <HeroStat label="LAST UPDATE" value={now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })} />
            <HeroStat label="MARKET STATUS" value="LIVE" highlight />
          </div>
        </div>
      </div>

      {/* ─── Tab 导航栏 ──────────────────────────────────────────────────────── */}
      <div style={{ background: "#FFFFFF", borderBottom: "1px solid #E0E5EC" }}>
        <div className="px-6 flex items-center gap-0">
          {GROUPS.map(({ label, labelCN, accent }) => (
            <div
              key={label}
              className="px-5 py-3 text-xs font-bold uppercase tracking-wider cursor-default"
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                letterSpacing: "0.10em",
                color: "#0D1F3C",
                borderBottom: `3px solid ${accent === "green" ? "#00A651" : accent === "navy" ? "#1A3A5C" : accent === "gold" ? "#C8960C" : "#7A8A9A"}`,
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* ─── 主内容区 ────────────────────────────────────────────────────────── */}
      <main className="flex-1 px-4 py-4 overflow-auto">
        {isLoading ? (
          <div className="h-64 flex flex-col items-center justify-center gap-4">
            <Spinner className="h-8 w-8" style={{ color: "#00A651" } as any} />
            <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#7A8A9A", fontFamily: "'IBM Plex Mono', monospace" }}>
              LOADING INDICATORS…
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
            {/* ── FRED 数据列 ── */}
            {GROUPS.filter(g => g.key === "货币市场利率" || g.key === "流动性工具").map(({ key, label, labelCN, accent }, colIdx) => {
              const items = grouped[key] ?? [];
              return (
                <div key={key} className="flex flex-col gap-3">
                  <GroupHeader label={label} labelCN={labelCN} accent={accent} count={items.length} />
                  {items.map((item: any, i: number) => (
                    <div key={item.id} className="animate-slide-up" style={{ animationDelay: `${(colIdx * 5 + i) * 50}ms` }}>
                      <CompactIndicatorCard
                        title={INDICATOR_META[item.indicatorType]?.title ?? item.indicatorType}
                        shortTitle={INDICATOR_META[item.indicatorType]?.short ?? item.indicatorType}
                        currentValue={item.currentValue}
                        unit={item.unit}
                        changeValue={item.changeValue ? (() => {
                          const v = parseFloat(item.changeValue);
                          return String(Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(4));
                        })() : undefined}
                        changePercent={item.changePercent ? String(parseFloat(item.changePercent).toFixed(2)) : undefined}
                        riskLevel={item.riskLevel}
                        riskDescription={item.riskDescription}
                        lastUpdatedAt={String(item.lastUpdatedAt)}
                        group={label}
                        indicatorType={item.indicatorType}
                        accentColor={accent as "green" | "navy" | "gold" | "silver"}
                        sourceUrl={SOURCE_URLS[item.indicatorType]}
                      />
                    </div>
                  ))}
                </div>
              );
            })}

            {/* ── 黄金期货列 ── */}
            <div className="flex flex-col gap-3">
              <GroupHeader label="GOLD FUTURES" labelCN="黄金期货" accent="gold" count={goldCards.length} />
              {goldCards.map((card, i) => (
                <div key={card.type} className="animate-slide-up" style={{ animationDelay: `${(2 * 5 + i) * 50}ms` }}>
                  <CompactIndicatorCard
                    title={card.title}
                    shortTitle={card.short}
                    currentValue={card.currentValue}
                    unit={card.unit}
                    changeValue={card.changeValue}
                    changePercent={card.changePercent}
                    riskLevel={card.riskLevel}
                    riskDescription={card.riskDescription}
                    lastUpdatedAt={String(card.lastUpdatedAt)}
                    group="GOLD FUTURES"
                    indicatorType={card.type}
                    staticHistory={card.history}
                    externalLoading={gold.isLoading}
                    accentColor="gold"
                    sourceUrl={SOURCE_URLS[card.type]}
                  />
                </div>
              ))}
            </div>

            {/* ── 白银期货列 ── */}
            <div className="flex flex-col gap-3">
              <GroupHeader label="SILVER FUTURES" labelCN="白银期货" accent="silver" count={silverCards.length} />
              {silverCards.map((card, i) => (
                <div key={card.type} className="animate-slide-up" style={{ animationDelay: `${(3 * 5 + i) * 50}ms` }}>
                  <CompactIndicatorCard
                    title={card.title}
                    shortTitle={card.short}
                    currentValue={card.currentValue}
                    unit={card.unit}
                    changeValue={card.changeValue}
                    changePercent={card.changePercent}
                    riskLevel={card.riskLevel}
                    riskDescription={card.riskDescription}
                    lastUpdatedAt={String(card.lastUpdatedAt)}
                    group="SILVER FUTURES"
                    indicatorType={card.type}
                    staticHistory={card.history}
                    externalLoading={silver.isLoading}
                    accentColor="silver"
                    sourceUrl={SOURCE_URLS[card.type]}
                  />
                </div>
              ))}
            </div>

            {/* ── 风险指标列（VIX / MOVE / US 5Y CDS）── */}
            <div className="flex flex-col gap-3">
              <GroupHeader label="RISK INDICATORS" labelCN="风险指标" accent="red" count={(grouped["风险指标"] ?? []).length + (move.data ? 1 : 0)} />
              {(grouped["风险指标"] ?? []).map((item: any, i: number) => (
                <div key={item.id} className="animate-slide-up" style={{ animationDelay: `${(4 * 5 + i) * 50}ms` }}>
                  <CompactIndicatorCard
                    title={INDICATOR_META[item.indicatorType]?.title ?? item.indicatorType}
                    shortTitle={INDICATOR_META[item.indicatorType]?.short ?? item.indicatorType}
                    currentValue={item.currentValue}
                    unit={item.unit}
                    changeValue={item.changeValue ? (() => {
                      const v = parseFloat(item.changeValue);
                      return String(Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(4));
                    })() : undefined}
                    changePercent={item.changePercent ? String(parseFloat(item.changePercent).toFixed(2)) : undefined}
                    riskLevel={item.riskLevel}
                    riskDescription={item.riskDescription}
                    lastUpdatedAt={String(item.lastUpdatedAt)}
                    group="RISK INDICATORS"
                    indicatorType={item.indicatorType}
                    accentColor={"red" as any}
                    sourceUrl={SOURCE_URLS[item.indicatorType]}
                  />
                </div>
              ))}
              {/* MOVE 指数 — 前端直接从 Yahoo Finance 获取 */}
              {move.data && (
                <div className="animate-slide-up">
                  <CompactIndicatorCard
                    title="MOVE 债券波动率指数"
                    shortTitle="MOVE"
                    currentValue={move.data.value}
                    unit="bps"
                    changeValue={move.data.changeValue}
                    changePercent={move.data.changePercent}
                    riskLevel={parseFloat(move.data.value) > 120 ? "warning" : parseFloat(move.data.value) > 80 ? "caution" : "normal"}
                    riskDescription="衡量美国国债市场隐含波动率，低于80正常，超过120高度紧张"
                    lastUpdatedAt={move.data.date}
                    group="RISK INDICATORS"
                    indicatorType="MOVE"
                    accentColor={"red" as any}
                    sourceUrl="https://finance.yahoo.com/quote/%5EMOVE/"
                  />
                </div>
              )}
              {/* 占位提示 */}
              {(grouped["风险指标"] ?? []).length === 0 && !move.data && !move.isLoading && (
                <div className="flex flex-col gap-2">
                  {["VIX 恐慌指数", "MOVE 债券波动率指数", "美国5年信用违约互换"].map((name) => (
                    <div key={name} className="rounded border px-4 py-3 text-xs" style={{ background: "#FFF5F5", border: "1px solid #FFCCCC", color: "#AA3333", fontFamily: "'IBM Plex Mono', monospace" }}>
                      {name} — 点击 REFRESH DATA 加载
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ─── 底部状态栏（CME 风格）──────────────────────────────────────────── */}
      <footer style={{ background: "#FFFFFF", borderTop: "1px solid #E0E5EC" }} className="flex-shrink-0 px-6 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-xs" style={{ color: "#7A8A9A", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.06em" }}>
            DATA SOURCES:
          </span>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#00A651" }} />
            <span className="text-xs font-semibold" style={{ color: "#5A6A7A", fontFamily: "'IBM Plex Mono', monospace" }}>FRED (Federal Reserve)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#00A651" }} />
            <span className="text-xs font-semibold" style={{ color: "#5A6A7A", fontFamily: "'IBM Plex Mono', monospace" }}>CME COMEX</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs hidden md:inline" style={{ color: "#AABAC8", fontFamily: "'IBM Plex Mono', monospace" }}>
            Market data delayed · Not financial advice
          </span>
          <span className="text-xs font-semibold tabular-nums" style={{ color: "#7A8A9A", fontFamily: "'IBM Plex Mono', monospace" }}>
            {now.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
          </span>
        </div>
      </footer>
    </div>
  );
}

// ─── Hero 摘要数据项 ──────────────────────────────────────────────────────────
function HeroStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#7AAFD4", fontFamily: "'IBM Plex Mono', monospace" }}>{label}</span>
      <span className="text-lg font-bold tabular-nums" style={{ color: highlight ? "#00C060" : "#FFFFFF", fontFamily: "'IBM Plex Mono', monospace" }}>{value}</span>
    </div>
  );
}

// ─── 分组标题组件（CME 风格）─────────────────────────────────────────────────
const ACCENT_CONFIG: Record<string, { bar: string; text: string; bg: string; border: string }> = {
  green:  { bar: "#00A651", text: "#0D5C2E", bg: "#F0FAF4", border: "#B2DFCC" },
  navy:   { bar: "#1A3A5C", text: "#0D1F3C", bg: "#EEF2F7", border: "#B8C8D8" },
  gold:   { bar: "#C8960C", text: "#7A5800", bg: "#FDF8EE", border: "#E8D48A" },
  silver: { bar: "#7A8A9A", text: "#3A4A5A", bg: "#F4F6F8", border: "#C8D4DC" },
  red:    { bar: "#CC2200", text: "#8B1500", bg: "#FFF5F3", border: "#FFCCBB" },
};

function GroupHeader({ label, labelCN, accent, count }: { label: string; labelCN: string; accent: string; count: number }) {
  const c = ACCENT_CONFIG[accent] ?? ACCENT_CONFIG.green;
  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2.5 rounded"
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
    >
      {/* 左侧色条 */}
      <div style={{ width: "4px", height: "28px", background: c.bar, borderRadius: "2px", flexShrink: 0 }} />

      {/* 标题 */}
      <div className="flex-1 min-w-0">
        <div className="font-bold text-xs uppercase tracking-widest leading-tight truncate" style={{ color: c.text, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.12em" }}>
          {label}
        </div>
        <div className="text-xs leading-tight" style={{ color: "#7A8A9A", fontFamily: "'Inter', sans-serif" }}>
          {labelCN}
        </div>
      </div>

      {/* 计数 */}
      <span
        className="text-xs font-bold px-2 py-0.5 rounded-full"
        style={{ background: c.bar, color: "#FFFFFF", fontFamily: "'IBM Plex Mono', monospace", minWidth: "22px", textAlign: "center" }}
      >
        {count}
      </span>
    </div>
  );
}
