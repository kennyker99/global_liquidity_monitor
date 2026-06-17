import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card } from "./ui/card";

interface DataPoint {
  date: string;
  value: number;
}

interface TrendChartProps {
  title: string;
  data: DataPoint[];
  unit: string;
  color?: string;
  height?: number;
}

export function TrendChart({
  title,
  data,
  unit,
  color = "#3b82f6",
  height = 300,
}: TrendChartProps) {
  // 格式化数据用于图表展示
  const chartData = useMemo(() => {
    return data
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((point) => ({
        ...point,
        date: new Date(point.date).toLocaleDateString("zh-CN", {
          month: "short",
          day: "numeric",
        }),
      }));
  }, [data]);

  if (chartData.length === 0) {
    return (
      <Card className="border-border/40 bg-card p-6">
        <p className="text-center text-muted-foreground">暂无数据</p>
      </Card>
    );
  }

  return (
    <Card className="border-border/40 bg-card p-6">
      <h3 className="mb-4 text-sm font-semibold text-card-foreground">
        {title}
      </h3>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={chartData}
          margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            opacity={0.3}
          />
          <XAxis
            dataKey="date"
            stroke="var(--muted-foreground)"
            style={{ fontSize: "0.75rem" }}
          />
          <YAxis
            stroke="var(--muted-foreground)"
            style={{ fontSize: "0.75rem" }}
            label={{ value: unit, angle: -90, position: "insideLeft" }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--card)",
              border: `1px solid var(--border)`,
              borderRadius: "0.5rem",
              color: "var(--card-foreground)",
            }}
            formatter={(value: number) => [
              value.toFixed(2),
              `${title} (${unit})`,
            ]}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            dot={false}
            strokeWidth={2}
            name={title}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
