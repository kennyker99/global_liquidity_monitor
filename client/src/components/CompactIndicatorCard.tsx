/**
 * 紧凑型指标卡片 - CME Group 风格
 * 白色卡片 + 深海军蓝文字 + CME 绿色强调
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Minus, X, ExternalLink } from "lucide-react";
import { HistoryTimeline } from "./HistoryTimeline";
import { StaticHistoryTimeline } from "./StaticHistoryTimeline";

export interface StaticHistoryRecord {
  observationDate: string;
  value: string;
  unit: string;
}

interface CompactIndicatorCardProps {
  title: string;
  shortTitle: string;
  currentValue: string;
  unit: string;
  changeValue?: string;
  changePercent?: string;
  riskLevel: "normal" | "caution" | "warning";
  riskDescription: string;
  lastUpdatedAt: string;
  group: string;
  indicatorType?: string;
  staticHistory?: StaticHistoryRecord[];
  externalLoading?: boolean;
  accentColor?: "green" | "navy" | "gold" | "silver";
  sourceUrl?: string;
}

// ─── 强调色配置（CME 风格）────────────────────────────────────────────────────
const ACCENT: Record<string, { bar: string; badgeBg: string; badgeText: string; badgeBorder: string }> = {
  green:  { bar: "#00A651", badgeBg: "#E8F5EE", badgeText: "#007A3D", badgeBorder: "#B2DFCC" },
  navy:   { bar: "#1A3A5C", badgeBg: "#EEF2F7", badgeText: "#0D1F3C", badgeBorder: "#B8C8D8" },
  gold:   { bar: "#C8960C", badgeBg: "#FDF8EE", badgeText: "#7A5800", badgeBorder: "#E8D48A" },
  silver: { bar: "#7A8A9A", badgeBg: "#F4F6F8", badgeText: "#3A4A5A", badgeBorder: "#C8D4DC" },
};

// ─── 风险等级配置 ─────────────────────────────────────────────────────────────
const RISK_CONFIG = {
  normal:  { label: "NORMAL",  badgeBg: "#E8F5EE", badgeText: "#007A3D", badgeBorder: "#B2DFCC" },
  caution: { label: "CAUTION", badgeBg: "#FFF8E1", badgeText: "#B8860B", badgeBorder: "#FFE082" },
  warning: { label: "ALERT",   badgeBg: "#FFEBEE", badgeText: "#C62828", badgeBorder: "#FFCDD2" },
};

const MONO = { fontFamily: "'IBM Plex Mono', 'Courier New', monospace" };
const SANS = { fontFamily: "'Inter', 'Helvetica Neue', sans-serif" };

function formatDate(dateString: string) {
  if (!dateString) return "—";
  try {
    const d = new Date(dateString.length === 10 ? dateString + "T00:00:00Z" : dateString);
    if (isNaN(d.getTime())) return dateString;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return dateString; }
}

function formatFullDate(dateString: string) {
  if (!dateString) return "—";
  try {
    const d = new Date(dateString.length === 10 ? dateString + "T00:00:00Z" : dateString);
    if (isNaN(d.getTime())) return dateString;
    return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch { return dateString; }
}

export function CompactIndicatorCard({
  title,
  shortTitle,
  currentValue,
  unit,
  changeValue,
  changePercent,
  riskLevel,
  riskDescription,
  lastUpdatedAt,
  group,
  indicatorType,
  staticHistory,
  externalLoading,
  accentColor = "green",
  sourceUrl,
}: CompactIndicatorCardProps) {
  const [showDetail, setShowDetail] = useState(false);
  const accent = ACCENT[accentColor] ?? ACCENT.green;
  const risk = RISK_CONFIG[riskLevel];
  const changeNum = changeValue ? parseFloat(changeValue) : 0;
  const isPositive = changeNum > 0;
  const isNegative = changeNum < 0;

  return (
    <>
      {/* ── 卡片主体 ── */}
      <div
        onClick={() => setShowDetail(true)}
        className="relative cursor-pointer rounded overflow-hidden transition-all duration-150 active:scale-[0.99]"
        style={{
          background: "#FFFFFF",
          border: "1px solid #E0E5EC",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.borderColor = accent.bar;
          (e.currentTarget as HTMLElement).style.boxShadow = `0 2px 12px rgba(0,0,0,0.10), 0 0 0 1px ${accent.bar}22`;
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.borderColor = "#E0E5EC";
          (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)";
        }}
      >
        {/* 左侧色条 */}
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "4px", background: accent.bar }} />

        {/* 卡片内容 */}
        <div style={{ paddingLeft: "16px", paddingRight: "12px", paddingTop: "12px", paddingBottom: "12px" }}>

          {/* 标题行 */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0">
              <div
                className="font-bold uppercase tracking-wider truncate leading-tight"
                style={{ ...MONO, fontSize: "13px", color: "#0D1F3C", letterSpacing: "0.08em" }}
              >
                {shortTitle}
              </div>
            </div>
            {/* 风险徽章 */}
            <span
              className="text-xs font-bold px-2 py-0.5 rounded flex-shrink-0"
              style={{ ...MONO, fontSize: "10px", letterSpacing: "0.08em", background: risk.badgeBg, color: risk.badgeText, border: `1px solid ${risk.badgeBorder}` }}
            >
              {risk.label}
            </span>
          </div>

          {/* 分隔线 */}
          <div style={{ height: "1px", background: "#F0F2F5", marginBottom: "10px" }} />

          {/* 主数值 */}
          <div className="flex items-baseline gap-2 mb-2">
            <span
              className="font-bold tabular-nums leading-none"
              style={{ ...MONO, fontSize: "32px", color: "#0D1F3C" }}
            >
              {currentValue}
            </span>
            <span
              className="font-semibold leading-none"
              style={{ ...MONO, fontSize: "13px", color: "#7A8A9A" }}
            >
              {unit}
            </span>
          </div>

          {/* 变化值行 */}
          {changeValue && changeValue !== "N/A" && (
            <div className="flex items-center gap-1 mb-2">
              {isPositive && <ArrowUp style={{ width: "13px", height: "13px", color: "#D32F2F", flexShrink: 0 }} />}
              {isNegative && <ArrowDown style={{ width: "13px", height: "13px", color: "#00A651", flexShrink: 0 }} />}
              {!isPositive && !isNegative && <Minus style={{ width: "13px", height: "13px", color: "#AABAC8", flexShrink: 0 }} />}
              <span
                className="font-semibold tabular-nums"
                style={{
                  ...MONO,
                  fontSize: "13px",
                  color: isPositive ? "#D32F2F" : isNegative ? "#00A651" : "#AABAC8",
                }}
              >
                {isPositive ? "+" : ""}{changeValue}
                {changePercent && (
                  <span style={{ color: isPositive ? "#EF5350" : isNegative ? "#4CAF50" : "#AABAC8", marginLeft: "4px" }}>
                    ({isPositive ? "+" : ""}{changePercent}%)
                  </span>
                )}
              </span>
            </div>
          )}

          {/* 日期行 */}
          <div
            className="flex items-center justify-between"
          >
            <span style={{ ...MONO, fontSize: "11px", color: "#AABAC8", letterSpacing: "0.06em" }}>
              {formatDate(lastUpdatedAt)}
            </span>
            {sourceUrl ? (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                title="查看原始数据"
                style={{ display: "flex", alignItems: "center", color: "#AABAC8", transition: "color 0.15s" }}
                onMouseEnter={e => (e.currentTarget.style.color = accent.bar)}
                onMouseLeave={e => (e.currentTarget.style.color = "#AABAC8")}
              >
                <ExternalLink style={{ width: "11px", height: "11px" }} />
              </a>
            ) : (
              <ExternalLink style={{ width: "11px", height: "11px", color: "#CCCCCC" }} />
            )}
          </div>
        </div>
      </div>

      {/* ── 详情弹窗（CME 风格）── */}
      {showDetail && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(13, 31, 60, 0.65)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowDetail(false); }}
        >
          <div
            className="w-full max-w-lg rounded overflow-hidden animate-slide-up"
            style={{
              background: "#FFFFFF",
              border: "1px solid #E0E5EC",
              boxShadow: "0 20px 60px rgba(13,31,60,0.25), 0 4px 16px rgba(0,0,0,0.12)",
              maxHeight: "85vh",
              overflowY: "auto",
            }}
          >
            {/* 顶部色条 */}
            <div style={{ height: "4px", background: accent.bar }} />

            {/* 弹窗头部 */}
            <div
              className="sticky top-0 flex items-start justify-between gap-3 px-6 py-4"
              style={{ background: "#FFFFFF", borderBottom: "1px solid #F0F2F5" }}
            >
              <div>
                <div style={{ ...MONO, fontSize: "10px", color: "#7A8A9A", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "4px" }}>
                  {group}
                </div>
                <h2 style={{ ...SANS, fontSize: "16px", fontWeight: 700, color: "#0D1F3C", lineHeight: 1.3 }}>
                  {title}
                </h2>
              </div>
              <button
                onClick={() => setShowDetail(false)}
                className="mt-1 p-1.5 rounded transition-colors flex-shrink-0"
                style={{ background: "transparent", border: "1px solid #E0E5EC" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#F5F7FA")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <X style={{ width: "16px", height: "16px", color: "#7A8A9A" }} />
              </button>
            </div>

            {/* 弹窗内容 */}
            <div className="px-6 py-5 space-y-5">
              {/* 主数值区 */}
              <div>
                <div className="flex items-baseline gap-3 mb-2">
                  <span style={{ ...MONO, fontSize: "44px", fontWeight: 700, color: "#0D1F3C", lineHeight: 1 }}>
                    {currentValue}
                  </span>
                  <span style={{ ...MONO, fontSize: "16px", color: "#7A8A9A", fontWeight: 600 }}>{unit}</span>
                </div>
                {changeValue && changeValue !== "N/A" && (
                  <div className="flex items-center gap-1.5">
                    {isPositive && <ArrowUp style={{ width: "15px", height: "15px", color: "#D32F2F" }} />}
                    {isNegative && <ArrowDown style={{ width: "15px", height: "15px", color: "#00A651" }} />}
                    {!isPositive && !isNegative && <Minus style={{ width: "15px", height: "15px", color: "#AABAC8" }} />}
                    <span style={{ ...MONO, fontSize: "14px", fontWeight: 600, color: isPositive ? "#D32F2F" : isNegative ? "#00A651" : "#AABAC8" }}>
                      {isPositive ? "+" : ""}{changeValue}
                      {changePercent && ` (${isPositive ? "+" : ""}${changePercent}%)`}
                    </span>
                  </div>
                )}
              </div>

              {/* 分隔线 */}
              <div style={{ height: "1px", background: "#F0F2F5" }} />

              {/* 状态说明 */}
              <div
                className="rounded p-4"
                style={{ background: risk.badgeBg, border: `1px solid ${risk.badgeBorder}` }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: risk.badgeText, flexShrink: 0 }} />
                  <span style={{ ...MONO, fontSize: "11px", fontWeight: 700, color: risk.badgeText, letterSpacing: "0.10em", textTransform: "uppercase" }}>
                    {risk.label}
                  </span>
                </div>
                <p style={{ ...SANS, fontSize: "13px", color: "#3A4A5A", lineHeight: 1.6 }}>{riskDescription}</p>
              </div>

              {/* 元数据 */}
              <div className="grid grid-cols-2 gap-3">
                <div style={{ background: "#F5F7FA", borderRadius: "4px", padding: "10px 12px" }}>
                  <div style={{ ...MONO, fontSize: "10px", color: "#AABAC8", letterSpacing: "0.10em", textTransform: "uppercase", marginBottom: "4px" }}>LAST UPDATE</div>
                  <div style={{ ...MONO, fontSize: "13px", color: "#0D1F3C", fontWeight: 600 }}>{formatFullDate(lastUpdatedAt)}</div>
                </div>
                <div style={{ background: "#F5F7FA", borderRadius: "4px", padding: "10px 12px" }}>
                  <div style={{ ...MONO, fontSize: "10px", color: "#AABAC8", letterSpacing: "0.10em", textTransform: "uppercase", marginBottom: "4px" }}>DATA SOURCE</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ ...MONO, fontSize: "13px", color: "#0D1F3C", fontWeight: 600 }}>
                      {indicatorType?.startsWith("GOLD_") || indicatorType?.startsWith("SILVER_")
                        ? "CME COMEX"
                        : indicatorType === "MOVE"
                        ? "Yahoo Finance"
                        : indicatorType === "US_CDS_5Y"
                        ? "WorldGovBonds"
                        : "FRED API"}
                    </span>
                    {sourceUrl && (
                      <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: "inline-flex", alignItems: "center", gap: "3px", ...MONO, fontSize: "11px", fontWeight: 700, color: "#00A651", textDecoration: "none", border: "1px solid #B2DFCC", borderRadius: "3px", padding: "2px 7px", background: "#E8F5EE", letterSpacing: "0.06em", transition: "all 0.15s" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#00A651"; (e.currentTarget as HTMLElement).style.color = "#FFFFFF"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#E8F5EE"; (e.currentTarget as HTMLElement).style.color = "#00A651"; }}
                      >
                        <ExternalLink style={{ width: "10px", height: "10px" }} />
                        VIEW DATA
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* 历史数据 */}
              {indicatorType && (
                <div>
                  <div style={{ ...MONO, fontSize: "10px", color: "#AABAC8", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "12px", fontWeight: 700 }}>
                    HISTORICAL OBSERVATIONS
                  </div>
                  {staticHistory !== undefined ? (
                    <StaticHistoryTimeline history={staticHistory} isLoading={externalLoading ?? false} />
                  ) : (
                    <HistoryTimeline indicatorType={indicatorType} title={title} limit={6} />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      , document.body)}
    </>
  );
}
