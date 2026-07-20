"use client";

import { useLocale } from "next-intl";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

export type TrendPoint = { month: string; income: number; expenses: number; net: number };

export function MonthlyTrendChart({
  data,
  labels,
}: {
  data: TrendPoint[];
  labels: { income: string; expenses: string };
}) {
  const locale = useLocale();
  const rtl = locale === "ar";

  return (
    <div dir="ltr" className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
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
            width={48}
          />
          <Tooltip
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--card-foreground)",
            }}
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="income" name={labels.income} fill="var(--success)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="expenses" name={labels.expenses} fill="var(--destructive)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
