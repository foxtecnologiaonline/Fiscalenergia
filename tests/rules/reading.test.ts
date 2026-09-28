import type { Bill } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  applyReadingRules,
  checkAtypicalBillingPeriod,
  checkConsumptionAnomaly,
  checkReadingDivergence,
} from "@/lib/rules/reading";

function makeBill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: "bill-1",
    consumerUnitId: "unit-1",
    referenceMonth: new Date("2026-03-01T00:00:00.000Z"),
    fileUrl: "https://blob.example.com/fake.pdf",
    status: "done",
    createdAt: new Date("2026-03-05T00:00:00.000Z"),
    totalAmount: null,
    consumptionKwh: null,
    tariffFlag: null,
    previousReadingKwh: null,
    currentReadingKwh: null,
    billingDays: null,
    appliedKwhRate: null,
    lineItems: null,
    extractedData: null,
    errorMessage: null,
    ...overrides,
  };
}

describe("checkReadingDivergence", () => {
  it("flags a divergence beyond tolerance", () => {
    const bill = makeBill({
      previousReadingKwh: 1000,
      currentReadingKwh: 1300,
      consumptionKwh: 250,
    });
    const findings = checkReadingDivergence(bill);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleCode).toBe("reading.reading_divergence");
  });

  it("does not flag when the reading matches consumption exactly", () => {
    const bill = makeBill({
      previousReadingKwh: 1000,
      currentReadingKwh: 1300,
      consumptionKwh: 300,
    });
    expect(checkReadingDivergence(bill)).toEqual([]);
  });

  it("does not flag when any of the three values is unidentified", () => {
    const bill = makeBill({
      previousReadingKwh: 1000,
      currentReadingKwh: null,
      consumptionKwh: 300,
    });
    expect(checkReadingDivergence(bill)).toEqual([]);
  });
});

describe("checkAtypicalBillingPeriod", () => {
  it("flags a period shorter than 28 days", () => {
    const findings = checkAtypicalBillingPeriod(makeBill({ billingDays: 20 }));
    expect(findings).toHaveLength(1);
  });

  it("flags a period longer than 32 days", () => {
    const findings = checkAtypicalBillingPeriod(makeBill({ billingDays: 40 }));
    expect(findings).toHaveLength(1);
  });

  it("does not flag a typical period", () => {
    expect(checkAtypicalBillingPeriod(makeBill({ billingDays: 30 }))).toEqual(
      [],
    );
  });

  it("does not flag when billingDays is unidentified", () => {
    expect(checkAtypicalBillingPeriod(makeBill({ billingDays: null }))).toEqual(
      [],
    );
  });
});

describe("checkConsumptionAnomaly", () => {
  it("does not evaluate with no prior history (never errors on a single bill)", () => {
    const bill = makeBill({ consumptionKwh: 1000 });
    expect(checkConsumptionAnomaly(bill, [])).toEqual([]);
  });

  it("flags a consumption far above the historical average", () => {
    const bill = makeBill({ consumptionKwh: 600, appliedKwhRate: 1 });
    const findings = checkConsumptionAnomaly(bill, [300, 310, 290]);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe("consumption_anomaly");
  });

  it("does not flag a consumption within the normal range", () => {
    const bill = makeBill({ consumptionKwh: 310 });
    expect(checkConsumptionAnomaly(bill, [300, 310, 290])).toEqual([]);
  });
});

describe("applyReadingRules", () => {
  it("produces no findings for a fully consistent bill with a single prior bill", () => {
    const bill = makeBill({
      previousReadingKwh: 1000,
      currentReadingKwh: 1300,
      consumptionKwh: 300,
      billingDays: 30,
    });
    expect(applyReadingRules(bill, [300])).toEqual([]);
  });
});
