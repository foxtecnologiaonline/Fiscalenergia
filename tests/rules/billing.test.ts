import type { Bill, TariffReference } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  applyBillingRules,
  checkIcmsRate,
  checkKwhRate,
  checkLineItemMath,
  checkTariffFlag,
} from "@/lib/rules/billing";

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

function makeTariffReference(
  overrides: Partial<TariffReference> = {},
): TariffReference {
  return {
    id: "ref-1",
    distributor: "Enel SP",
    uf: "SP",
    tariffGroup: "B",
    tariffSubgroup: "B1",
    validFrom: new Date("2025-01-01T00:00:00.000Z"),
    validTo: null,
    kwhRate: 0.98,
    icmsRate: 0.18,
    ...overrides,
  };
}

describe("checkTariffFlag", () => {
  it("flags a mismatched tariff flag", () => {
    const bill = makeBill({ tariffFlag: "verde" });
    const findings = checkTariffFlag(bill, "amarela");
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleCode).toBe("billing.tariff_flag_mismatch");
  });

  it("does not flag a matching tariff flag", () => {
    const bill = makeBill({ tariffFlag: "amarela" });
    expect(checkTariffFlag(bill, "amarela")).toEqual([]);
  });

  it("does not flag when the bill's flag is null (unidentified)", () => {
    const bill = makeBill({ tariffFlag: null });
    expect(checkTariffFlag(bill, "amarela")).toEqual([]);
  });

  it("does not flag when there is no reference data for the month", () => {
    const bill = makeBill({ tariffFlag: "verde" });
    expect(checkTariffFlag(bill, null)).toEqual([]);
  });
});

describe("checkKwhRate", () => {
  it("flags a mismatched kWh rate with an estimated impact", () => {
    const bill = makeBill({ appliedKwhRate: 1.05, consumptionKwh: 300 });
    const reference = makeTariffReference({ kwhRate: 0.98 });
    const findings = checkKwhRate(bill, reference);
    expect(findings).toHaveLength(1);
    expect(findings[0].estimatedImpactAmount).toBeCloseTo((1.05 - 0.98) * 300);
  });

  it("does not flag a rate within tolerance", () => {
    const bill = makeBill({ appliedKwhRate: 0.981, consumptionKwh: 300 });
    const reference = makeTariffReference({ kwhRate: 0.98 });
    expect(checkKwhRate(bill, reference)).toEqual([]);
  });

  it("does not flag when there is no reference for this distributor/UF/group", () => {
    const bill = makeBill({ appliedKwhRate: 5, consumptionKwh: 300 });
    expect(checkKwhRate(bill, null)).toEqual([]);
  });

  it("does not flag when appliedKwhRate is unidentified", () => {
    const bill = makeBill({ appliedKwhRate: null });
    expect(checkKwhRate(bill, makeTariffReference())).toEqual([]);
  });
});

describe("checkIcmsRate", () => {
  it("flags an ICMS line item with a diverging rate", () => {
    const bill = makeBill({
      lineItems: [
        { description: "ICMS", quantity: 300, unitRate: 0.25, amount: 75 },
      ],
    });
    const findings = checkIcmsRate(bill, makeTariffReference({ icmsRate: 0.18 }));
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleCode).toBe("billing.icms_rate_mismatch");
  });

  it("does not flag a matching ICMS rate", () => {
    const bill = makeBill({
      lineItems: [
        { description: "ICMS", quantity: 300, unitRate: 0.18, amount: 54 },
      ],
    });
    expect(checkIcmsRate(bill, makeTariffReference({ icmsRate: 0.18 }))).toEqual(
      [],
    );
  });

  it("ignores non-ICMS line items", () => {
    const bill = makeBill({
      lineItems: [
        { description: "Consumo TE", quantity: 300, unitRate: 0.5, amount: 150 },
      ],
    });
    expect(checkIcmsRate(bill, makeTariffReference({ icmsRate: 0.18 }))).toEqual(
      [],
    );
  });
});

describe("checkLineItemMath", () => {
  it("flags a line item whose amount does not match quantity * unitRate", () => {
    const bill = makeBill({
      lineItems: [
        {
          description: "Consumo TE",
          quantity: 300,
          unitRate: 0.5,
          amount: 200,
        },
      ],
    });
    const findings = checkLineItemMath(bill);
    expect(findings).toHaveLength(1);
    expect(findings[0].estimatedImpactAmount).toBeCloseTo(200 - 150);
  });

  it("does not flag a line item that closes correctly", () => {
    const bill = makeBill({
      lineItems: [
        {
          description: "Consumo TE",
          quantity: 300,
          unitRate: 0.5,
          amount: 150,
        },
      ],
    });
    expect(checkLineItemMath(bill)).toEqual([]);
  });

  it("skips a line item with an unidentified field", () => {
    const bill = makeBill({
      lineItems: [
        { description: "Item ilegível", quantity: null, unitRate: 0.5, amount: 200 },
      ],
    });
    expect(checkLineItemMath(bill)).toEqual([]);
  });
});

describe("applyBillingRules", () => {
  it("produces no findings for a fully correct bill", () => {
    const bill = makeBill({
      tariffFlag: "verde",
      appliedKwhRate: 0.98,
      consumptionKwh: 300,
      lineItems: [
        { description: "Consumo TE", quantity: 300, unitRate: 0.98, amount: 294 },
        { description: "ICMS", quantity: 294, unitRate: 0.18, amount: 52.92 },
      ],
    });

    const findings = applyBillingRules(bill, {
      tariffFlag: "verde",
      tariffReference: makeTariffReference(),
    });

    expect(findings).toEqual([]);
  });
});
