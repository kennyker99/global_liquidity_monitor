import { ArrowDown, ArrowUp, TrendingUp } from "lucide-react";
import { Card } from "./ui/card";
import { HistoryTimeline } from "./HistoryTimeline";
import { StaticHistoryTimeline } from "./StaticHistoryTimeline";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

export interface StaticHistoryRecord {
  observationDate: string;
  value: string;
  unit: string;
}

interface IndicatorCardProps {
  title: string;
  currentValue: string;
  unit: string;
  changeValue?: string;
  changePercent?: string;
  riskLevel: "normal" | "caution" | "warning";
  riskDescription: string;
  lastUpdatedAt: string;
  group: string;
  indicatorType?: string;
  /** 外部静态历史数据（用于 CME 黄金期货，绕过 tRPC） */
  staticHistory?: StaticHistoryRecord[];
  /** 是否正在加载外部数据 */
  externalLoading?: boolean;
}

export function IndicatorCard({
  title,
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
}: IndicatorCardProps) {
  const [showHistory, setShowHistory] = useState(false);
  // 解析变化值以判断方向
  const changeNum = changeValue ? parseFloat(changeValue) : 0;
  const isPositive = changeNum > 0;
  const isNegative = changeNum < 0;

  // 格式化日期
  const formatDate = (dateString: string | Date) => {
    try {
      let date: Date;
      if (dateString instanceof Date) {
        date = dateString;
      } else if (typeof dateString === "string") {
        date = new Date(dateString);
        if (isNaN(date.getTime()) && dateString.length === 10) {
          date = new Date(dateString + "T00:00:00Z");
        }
      } else {
        return "未知时间";
      }

      if (isNaN(date.getTime())) {
        return "无效日期";
      }

      return date.toLocaleDateString("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (error) {
      return typeof dateString === "string" ? dateString : "未知时间";
    }
  };

  // 状态颜色映射
  const statusColors = {
    normal: "border-status-normal/20 bg-gradient-to-br from-card to-status-normal/5",
    caution:
      "border-status-caution/30 bg-gradient-to-br from-card to-status-caution/10",
    warning:
      "border-status-warning/40 bg-gradient-to-br from-card to-status-warning/15",
  };

  const badgeColors = {
    normal: "bg-status-normal/15 text-status-normal",
    caution: "bg-status-caution/15 text-status-caution",
    warning: "bg-status-warning/15 text-status-warning",
  };

  const statusLabels = {
    normal: "正常",
    caution: "注意",
    warning: "警告",
  };

  return (
    <Card
      className={`indicator-card ${statusColors[riskLevel]} border-2 transition-all duration-300 hover:shadow-xl hover:scale-[1.01] cursor-pointer animate-fade-in`}
    >
      <div className="space-y-4 p-1">
        {/* 头部：标题和状态徽章 */}
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {group}
            </h3>
            <h2 className="mt-1 text-lg font-bold text-card-foreground">{title}</h2>
          </div>
          <span
            className={`status-badge ${badgeColors[riskLevel]} px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all`}
          >
            {statusLabels[riskLevel]}
          </span>
        </div>

        {/* 主要数值 */}
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              {currentValue}
            </span>
            <span className="text-sm text-muted-foreground font-medium">{unit}</span>
          </div>

          {/* 变化指示 */}
          {changeValue && changeValue !== "N/A" && (
            <div className="flex items-center gap-2 pt-1">
              {isPositive && (
                <ArrowUp className="h-4 w-4 text-status-warning" />
              )}
              {isNegative && (
                <ArrowDown className="h-4 w-4 text-status-normal" />
              )}
              {!isPositive && !isNegative && (
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              )}
              <span
                className={`text-sm font-medium ${
                  isPositive
                    ? "text-status-warning"
                    : isNegative
                      ? "text-status-normal"
                      : "text-muted-foreground"
                }`}
              >
                {isPositive ? "+" : ""}
                {changeValue} ({isPositive ? "+" : ""}{changePercent}%)
              </span>
            </div>
          )}
        </div>

        {/* 风险说明 */}
        <div className="border-t border-border/50 pt-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {riskDescription}
          </p>
        </div>

        {/* 更新时间 */}
        <div className="flex items-center justify-between border-t border-border/50 pt-3">
          <span className="text-xs text-muted-foreground">
            更新于 {formatDate(lastUpdatedAt)}
          </span>
          {indicatorType && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowHistory(!showHistory); }}
              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
            >
              <span>{showHistory ? "隐藏" : "查看"}历史</span>
              <ChevronDown
                className={`h-3 w-3 transition-transform ${
                  showHistory ? "rotate-180" : ""
                }`}
              />
            </button>
          )}
        </div>

        {/* 过往记录时间线 */}
        {showHistory && indicatorType && (
          <div className="border-t border-border/50 pt-4">
            {staticHistory !== undefined ? (
              <StaticHistoryTimeline
                history={staticHistory}
                isLoading={externalLoading ?? false}
              />
            ) : (
              <HistoryTimeline
                indicatorType={indicatorType}
                title={title}
                limit={6}
              />
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
