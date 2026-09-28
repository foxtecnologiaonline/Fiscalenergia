"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type RankingEntry = {
  name: string;
  room: string;
  estimatedKwh: number;
};

const numberFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
});

export function ConsumptionRankingChart({ entries }: { entries: RankingEntry[] }) {
  const data = entries
    .map((entry) => ({
      label: `${entry.name} (${entry.room})`,
      kwh: entry.estimatedKwh,
    }))
    .sort((a, b) => b.kwh - a.kwh);

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 24, bottom: 8, left: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={(value: number) => numberFormatter.format(value)}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={160}
            tick={{ fontSize: 12 }}
          />
          <Tooltip
            formatter={(value) => [
              `${numberFormatter.format(Number(value))} kWh/mês`,
              "Consumo estimado",
            ]}
          />
          <Bar dataKey="kwh" fill="var(--primary)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
