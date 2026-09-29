"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { MonthlyDataPoint } from "@/lib/dashboard";

export type MonthlyChartValueType = "kwh" | "currency";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const kwhFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
});

function formatAxisValue(value: number, valueType: MonthlyChartValueType) {
  return valueType === "currency"
    ? currencyFormatter.format(value)
    : kwhFormatter.format(value);
}

function formatTooltipValue(value: number, valueType: MonthlyChartValueType) {
  return valueType === "currency"
    ? currencyFormatter.format(value)
    : `${kwhFormatter.format(value)} kWh`;
}

/**
 * Gráfico de série única (mês x valor). Cada métrica (kWh, R$) tem seu
 * próprio gráfico com sua própria cor fixa — nunca um eixo duplo no mesmo
 * gráfico (ver skill dataviz: "one axis, never a dual-axis chart").
 * `valueType` decide a formatação (função, não pode atravessar a fronteira
 * server->client component, por isso o componente formata internamente em
 * vez de receber formatters como prop).
 */
export function MonthlyBarChart({
  data,
  valueKey,
  color,
  seriesLabel,
  valueType,
}: {
  data: MonthlyDataPoint[];
  valueKey: "consumptionKwh" | "totalAmount";
  color: string;
  seriesLabel: string;
  valueType: MonthlyChartValueType;
}) {
  const chartData = data.map((point) => ({
    month: point.month,
    value: point[valueKey],
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 12 }} />
          <YAxis
            width={56}
            tick={{ fontSize: 12 }}
            tickFormatter={(value: number) => formatAxisValue(value, valueType)}
          />
          <Tooltip
            formatter={(value) => formatTooltipValue(Number(value), valueType)}
          />
          <Bar
            dataKey="value"
            name={seriesLabel}
            fill={color}
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
