/**
 * 静态历史记录时间线组件（CME 数据）
 * 白色背景 + 深色文字，符合 CME Group 专业风格
 */

import { Spinner } from "./ui/spinner";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";

const MONO = { fontFamily: "'IBM Plex Mono', 'Courier New', monospace" };

interface StaticRecord {
  observationDate: string;
  value: string;
  unit: string;
}

interface StaticHistoryTimelineProps {
  history: StaticRecord[];
  isLoading?: boolean;
}

export function StaticHistoryTimeline({ history, isLoading = false }: StaticHistoryTimelineProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 gap-2" style={{ background: "#F5F7FA", borderRadius: "4px" }}>
        <Spinner className="h-4 w-4" style={{ color: "#00A651" } as any} />
        <span style={{ ...MONO, fontSize: "11px", color: "#7A8A9A", letterSpacing: "0.08em" }}>LOADING CME DATA…</span>
      </div>
    );
  }

  if (!history || history.length === 0) {
    return (
      <div className="py-4 text-center rounded" style={{ background: "#F5F7FA", border: "1px solid #E0E5EC" }}>
        <p style={{ ...MONO, fontSize: "11px", color: "#AABAC8", letterSpacing: "0.08em" }}>NO CME RECORDS AVAILABLE</p>
      </div>
    );
  }

  const sorted = [...history].sort((a, b) => b.observationDate.localeCompare(a.observationDate));

  const formatValue = (val: string) => {
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    if (Math.abs(num) >= 1000) return num.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (Math.abs(num) >= 10) return num.toFixed(2);
    return num.toFixed(3);
  };

  return (
    <div style={{ border: "1px solid #E0E5EC", borderRadius: "4px", overflow: "hidden", background: "#FFFFFF" }}>
      {/* 标题行 */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ background: "#F5F7FA", borderBottom: "1px solid #E0E5EC" }}
      >
        <span style={{ ...MONO, fontSize: "11px", fontWeight: 700, color: "#0D1F3C", letterSpacing: "0.12em", textTransform: "uppercase" }}>
          OBSERVATIONS
        </span>
        <div className="flex items-center gap-2">
          <span style={{ ...MONO, fontSize: "11px", color: "#7A8A9A" }}>最近 {sorted.length} 条</span>
          <span style={{ ...MONO, fontSize: "10px", fontWeight: 700, color: "#1A3A5C", background: "#EEF2F7", border: "1px solid #B8C8D8", borderRadius: "3px", padding: "1px 6px", letterSpacing: "0.08em" }}>
            CME
          </span>
        </div>
      </div>

      {/* 数据行 */}
      <div>
        {sorted.map((record, index) => {
          const nextRecord = sorted[index + 1];
          const curr = parseFloat(record.value);
          const prev = nextRecord ? parseFloat(nextRecord.value) : null;
          const diff = prev !== null && !isNaN(curr) && !isNaN(prev) ? curr - prev : null;
          const isUp = diff !== null && diff > 0;
          const isDown = diff !== null && diff < 0;
          const isFirst = index === 0;

          return (
            <div
              key={record.observationDate}
              className="flex items-center justify-between px-4"
              style={{
                paddingTop: "10px",
                paddingBottom: "10px",
                background: isFirst ? "#F0FAF4" : index % 2 === 0 ? "#FFFFFF" : "#FAFBFC",
                borderBottom: index < sorted.length - 1 ? "1px solid #F0F2F5" : "none",
                transition: "background 0.1s",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "#EEF2F7")}
              onMouseLeave={e => (e.currentTarget.style.background = isFirst ? "#F0FAF4" : index % 2 === 0 ? "#FFFFFF" : "#FAFBFC")}
            >
              {/* 日期 */}
              <span style={{
                ...MONO,
                fontSize: "12px",
                fontWeight: isFirst ? 600 : 400,
                color: isFirst ? "#0D1F3C" : "#5A6A7A",
                letterSpacing: "0.04em",
              }}>
                {record.observationDate}
              </span>

              {/* 数值 + 变化 */}
              <div className="flex items-center gap-3">
                {/* 变化指示 */}
                {diff !== null && (
                  <div className="flex items-center gap-0.5" style={{
                    ...MONO,
                    fontSize: "12px",
                    fontWeight: 600,
                    color: isUp ? "#D32F2F" : isDown ? "#00A651" : "#AABAC8",
                  }}>
                    {isUp && <TrendingUp style={{ width: "12px", height: "12px" }} />}
                    {isDown && <TrendingDown style={{ width: "12px", height: "12px" }} />}
                    {!isUp && !isDown && <Minus style={{ width: "12px", height: "12px" }} />}
                    <span style={{ marginLeft: "2px" }}>
                      {isUp ? "+" : ""}
                      {diff.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                )}

                {/* 数值 */}
                <span style={{
                  ...MONO,
                  fontSize: "14px",
                  fontWeight: 700,
                  color: "#0D1F3C",
                  minWidth: "60px",
                  textAlign: "right",
                }}>
                  {formatValue(record.value)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
