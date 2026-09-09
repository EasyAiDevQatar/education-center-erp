"use client";

import { useLocale } from "next-intl";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type BudgetChartPoint = {
  month: string;
  plannedIncome: number;
  projectedIncome: number;
  plannedExpenses: number;
  actualExpenses: number;
};

export function BudgetChart({
  data,
  labels,
}: {
  data: BudgetChartPoint[];
  labels: {
    plannedIncome: string;
    projectedIncome: string;
    plannedExpenses: string;
    actualExpenses: string;
  };
}) {
  const locale = useLocale();
  const rtl = locale === "ar";

  return (
    <div dir="ltr" className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="month"
            reversed={rtl}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
          />
          <YAxis
            orientation={rtl ? "right" : "left"}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={54}
          />
          <Tooltip
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--card-foreground)",
            }}
            cursor={{ fill: "var(--muted)", opacity: 0.35 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="plannedIncome"
            name={labels.plannedIncome}
            fill="var(--primary)"
            opacity={0.45}
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="plannedExpenses"
            name={labels.plannedExpenses}
            fill="var(--destructive)"
            opacity={0.4}
            radius={[4, 4, 0, 0]}
          />
          <Line
            type="monotone"
            dataKey="projectedIncome"
            name={labels.projectedIncome}
            stroke="var(--success)"
            strokeWidth={2.5}
            dot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="actualExpenses"
            name={labels.actualExpenses}
            stroke="var(--destructive)"
            strokeWidth={2.5}
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
