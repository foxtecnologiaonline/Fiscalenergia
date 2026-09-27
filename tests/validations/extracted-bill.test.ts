import { describe, expect, it } from "vitest";

import { extractedBillSchema } from "@/lib/validations/extracted-bill";

const fullyKnown = {
  totalAmount: 452.31,
  consumptionKwh: 320,
  tariffFlag: "amarela",
  previousReadingKwh: 1200,
  currentReadingKwh: 1520,
  billingDays: 30,
  appliedKwhRate: 0.98,
  lineItems: [
    {
      description: "Consumo TE",
      quantity: 320,
      unitRate: 0.98,
      amount: 313.6,
    },
  ],
};

const allUnknown = {
  totalAmount: null,
  consumptionKwh: null,
  tariffFlag: null,
  previousReadingKwh: null,
  currentReadingKwh: null,
  billingDays: null,
  appliedKwhRate: null,
  lineItems: [],
};

describe("extractedBillSchema", () => {
  it("accepts a fully extracted bill", () => {
    expect(extractedBillSchema.safeParse(fullyKnown).success).toBe(true);
  });

  it("accepts every field explicitly null (low-confidence extraction)", () => {
    expect(extractedBillSchema.safeParse(allUnknown).success).toBe(true);
  });

  it("rejects an invalid tariffFlag", () => {
    const result = extractedBillSchema.safeParse({
      ...allUnknown,
      tariffFlag: "roxa",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a line item missing description", () => {
    const result = extractedBillSchema.safeParse({
      ...allUnknown,
      lineItems: [{ quantity: 1, unitRate: 1, amount: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a line item with null quantity/unitRate/amount", () => {
    const result = extractedBillSchema.safeParse({
      ...allUnknown,
      lineItems: [
        {
          description: "Item ilegível",
          quantity: null,
          unitRate: null,
          amount: null,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
