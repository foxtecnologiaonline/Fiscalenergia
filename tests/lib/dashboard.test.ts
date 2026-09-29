import { describe, expect, it } from "vitest";

import { buildMonthlySeries, summarizeFindingsBySeverity } from "@/lib/dashboard";

describe("buildMonthlySeries", () => {
  it("returns an empty array for no bills", () => {
    expect(buildMonthlySeries([])).toEqual([]);
  });

  it("formats and sorts bills chronologically regardless of input order", () => {
    const series = buildMonthlySeries([
      {
        referenceMonth: new Date("2026-03-01T00:00:00.000Z"),
        consumptionKwh: 320,
        totalAmount: 450,
      },
      {
        referenceMonth: new Date("2026-01-01T00:00:00.000Z"),
        consumptionKwh: 300,
        totalAmount: 400,
      },
      {
        referenceMonth: new Date("2026-02-01T00:00:00.000Z"),
        consumptionKwh: 310,
        totalAmount: 420,
      },
    ]);

    expect(series.map((point) => point.month)).toEqual([
      "01/2026",
      "02/2026",
      "03/2026",
    ]);
    expect(series[0].consumptionKwh).toBe(300);
  });

  it("keeps null values for fields the extraction couldn't identify", () => {
    const series = buildMonthlySeries([
      {
        referenceMonth: new Date("2026-01-01T00:00:00.000Z"),
        consumptionKwh: null,
        totalAmount: null,
      },
    ]);
    expect(series).toEqual([
      { month: "01/2026", consumptionKwh: null, totalAmount: null },
    ]);
  });

  it("handles a single bill (still a valid one-point series)", () => {
    const series = buildMonthlySeries([
      {
        referenceMonth: new Date("2026-05-01T00:00:00.000Z"),
        consumptionKwh: 280,
        totalAmount: 390,
      },
    ]);
    expect(series).toHaveLength(1);
  });
});

describe("summarizeFindingsBySeverity", () => {
  it("returns all three severities at 0 for no findings", () => {
    expect(summarizeFindingsBySeverity([])).toEqual({
      low: 0,
      medium: 0,
      high: 0,
    });
  });

  it("counts findings per severity", () => {
    const counts = summarizeFindingsBySeverity([
      { severity: "high" },
      { severity: "high" },
      { severity: "medium" },
      { severity: "low" },
    ]);
    expect(counts).toEqual({ low: 1, medium: 1, high: 2 });
  });
});
