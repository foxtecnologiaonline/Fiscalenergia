import { describe, expect, it } from "vitest";

import { estimateMonthlyKwh } from "@/lib/calculations";

describe("estimateMonthlyKwh", () => {
  it("computes the expected value for a typical appliance", () => {
    // Geladeira: 150W, 8h/dia "equivalentes", 7 dias/semana, 1 unidade
    // (150 * 8 * (7/7) * 30) / 1000 * 1 = 36
    const kwh = estimateMonthlyKwh({
      powerW: 150,
      usageHoursPerDay: 8,
      usageDaysPerWeek: 7,
      quantity: 1,
    });
    expect(kwh).toBeCloseTo(36, 5);
  });

  it("scales linearly with quantity", () => {
    const single = estimateMonthlyKwh({
      powerW: 100,
      usageHoursPerDay: 2,
      usageDaysPerWeek: 5,
      quantity: 1,
    });
    const triple = estimateMonthlyKwh({
      powerW: 100,
      usageHoursPerDay: 2,
      usageDaysPerWeek: 5,
      quantity: 3,
    });
    expect(triple).toBeCloseTo(single * 3, 5);
  });

  it("returns 0 when quantity is 0", () => {
    expect(
      estimateMonthlyKwh({
        powerW: 1000,
        usageHoursPerDay: 5,
        usageDaysPerWeek: 7,
        quantity: 0,
      }),
    ).toBe(0);
  });

  it("returns 0 when usageHoursPerDay is 0", () => {
    expect(
      estimateMonthlyKwh({
        powerW: 1000,
        usageHoursPerDay: 0,
        usageDaysPerWeek: 7,
        quantity: 1,
      }),
    ).toBe(0);
  });

  it("returns 0 when usageDaysPerWeek is 0", () => {
    expect(
      estimateMonthlyKwh({
        powerW: 1000,
        usageHoursPerDay: 5,
        usageDaysPerWeek: 0,
        quantity: 1,
      }),
    ).toBe(0);
  });

  it("returns 0 when powerW is 0", () => {
    expect(
      estimateMonthlyKwh({
        powerW: 0,
        usageHoursPerDay: 5,
        usageDaysPerWeek: 7,
        quantity: 1,
      }),
    ).toBe(0);
  });

  it("prorates usageDaysPerWeek below 7 days", () => {
    // 1000W, 1h/dia, 3.5 dias/semana, 1 unidade
    // (1000 * 1 * (3.5/7) * 30) / 1000 * 1 = 15
    const kwh = estimateMonthlyKwh({
      powerW: 1000,
      usageHoursPerDay: 1,
      usageDaysPerWeek: 3.5,
      quantity: 1,
    });
    expect(kwh).toBeCloseTo(15, 5);
  });
});
