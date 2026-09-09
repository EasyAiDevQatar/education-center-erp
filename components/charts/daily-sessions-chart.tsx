"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDateOnly } from "@/lib/date-only";

export type DailySessionsPoint = {
  date: string;
  sessions: number;
  studentBookings: number;
};

type DailySessionsChartProps = {
  data: DailySessionsPoint[];
  labels: {
    sessions: string;
    studentBookings: string;
    ariaLabel: string;
  };
};

function sampleDateTicks(data: DailySessionsPoint[], maximumTicks = 10) {
  const dates = data.map((point) => point.date);

  if (dates.length <= maximumTicks) return dates;

  const lastIndex = dates.length - 1;
  const sampledIndices = new Set<number>();

  for (let tickIndex = 0; tickIndex < maximumTicks; tickIndex += 1) {
    sampledIndices.add(Math.round((tickIndex * lastIndex) / (maximumTicks - 1)));
  }

  // Only axis labels are sampled; every supplied data point remains in the chart.
  return [...sampledIndices].map((index) => dates[index]);
}

export function DailySessionsChart({ data, labels }: DailySessionsChartProps) {
  const locale = useLocale();
  const rtl = locale.startsWith("ar");
  const ticks = useMemo(() => sampleDateTicks(data), [data]);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  return (
    <div
      role="img"
      aria-label={labels.ariaLabel}
      dir="ltr"
      className="h-80 w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date"
            reversed={rtl}
            ticks={ticks}
            tickFormatter={(value: string) => formatDateOnly(value)}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={12}
          />
          <YAxis
            orientation={rtl ? "right" : "left"}
            allowDecimals={false}
            tickFormatter={(value: number) => numberFormatter.format(value)}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            labelFormatter={(value) => formatDateOnly(String(value))}
            formatter={(value, name) => [
              numberFormatter.format(Number(value ?? 0)),
              name,
            ]}
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--card-foreground)",
              direction: rtl ? "rtl" : "ltr",
              fontSize: 12,
              textAlign: rtl ? "right" : "left",
            }}
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          />
          <Legend
            formatter={(value) => <span dir={rtl ? "rtl" : "ltr"}>{value}</span>}
            wrapperStyle={{ fontSize: 12 }}
          />
          <Bar
            dataKey="sessions"
            name={labels.sessions}
            fill="var(--primary)"
            maxBarSize={32}
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="studentBookings"
            name={labels.studentBookings}
            fill="var(--warning)"
            maxBarSize={32}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
