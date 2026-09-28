// @vitest-environment node
import type { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { applyBillRules } from "@/lib/rules/apply-bill-rules";

const TEST_EMAIL_MARKER = "apply-bill-rules-test";
// Well outside the real seed's Oct/2025-Sep/2026 range and a distributor
// name that won't collide with the seeded ones, so this file never
// interferes with prisma/seed.ts's data or other test files.
const TEST_DISTRIBUTOR = "Test Distribuidora XYZ";
const MONTH_1 = new Date("2030-01-01T00:00:00.000Z");
const MONTH_2 = new Date("2030-02-01T00:00:00.000Z");

describe("applyBillRules", () => {
  let unitId: string;

  beforeEach(async () => {
    await db.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_MARKER } },
    });
    await db.tariffFlagHistory.deleteMany({
      where: { referenceMonth: { in: [MONTH_1, MONTH_2] } },
    });
    await db.tariffReference.deleteMany({
      where: { distributor: TEST_DISTRIBUTOR },
    });

    const user = await db.user.create({
      data: {
        email: `user-${Date.now()}@${TEST_EMAIL_MARKER}.com`,
        passwordHash: "hash",
      },
    });
    const unit = await db.consumerUnit.create({
      data: {
        ownerId: user.id,
        code: "UC-RULES-1",
        distributor: TEST_DISTRIBUTOR,
        uf: "SP",
        city: "São Paulo",
        tariffGroup: "B",
        tariffSubgroup: "B1",
        tariffModality: "Convencional",
      },
    });
    unitId = unit.id;

    await db.tariffFlagHistory.create({
      data: { referenceMonth: MONTH_1, flag: "verde" },
    });
    await db.tariffReference.create({
      data: {
        distributor: TEST_DISTRIBUTOR,
        uf: "SP",
        tariffGroup: "B",
        tariffSubgroup: "B1",
        validFrom: new Date("2020-01-01T00:00:00.000Z"),
        validTo: null,
        kwhRate: 0.98,
        icmsRate: 0.18,
      },
    });
  });

  afterAll(async () => {
    await db.tariffFlagHistory.deleteMany({
      where: { referenceMonth: { in: [MONTH_1, MONTH_2] } },
    });
    await db.tariffReference.deleteMany({
      where: { distributor: TEST_DISTRIBUTOR },
    });
    await db.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_MARKER } },
    });
    await db.$disconnect();
  });

  async function createDoneBill(overrides: Partial<Prisma.BillCreateInput>) {
    return db.bill.create({
      data: {
        consumerUnit: { connect: { id: unitId } },
        referenceMonth: MONTH_1,
        fileUrl: "https://blob.example.com/fake.pdf",
        status: "done",
        ...overrides,
      },
    });
  }

  it("creates a Finding when the bandeira is wrong (fixture manipulada)", async () => {
    const bill = await createDoneBill({ tariffFlag: "amarela" });

    const findings = await applyBillRules(bill.id);

    expect(
      findings.some((f) => f.ruleCode === "billing.tariff_flag_mismatch"),
    ).toBe(true);
  });

  it("creates a Finding when the kWh rate is wrong", async () => {
    const bill = await createDoneBill({
      tariffFlag: "verde",
      appliedKwhRate: 1.5,
      consumptionKwh: 300,
    });

    const findings = await applyBillRules(bill.id);

    expect(
      findings.some((f) => f.ruleCode === "billing.kwh_rate_mismatch"),
    ).toBe(true);
  });

  it("creates a Finding when a line item's math does not close", async () => {
    const bill = await createDoneBill({
      tariffFlag: "verde",
      appliedKwhRate: 0.98,
      consumptionKwh: 300,
      lineItems: [
        { description: "Consumo TE", quantity: 300, unitRate: 0.98, amount: 400 },
      ],
    });

    const findings = await applyBillRules(bill.id);

    expect(
      findings.some((f) => f.ruleCode === "billing.line_item_math_error"),
    ).toBe(true);
  });

  it("produces no findings (no false positives) for a fully correct bill", async () => {
    const bill = await createDoneBill({
      tariffFlag: "verde",
      appliedKwhRate: 0.98,
      consumptionKwh: 300,
      previousReadingKwh: 1000,
      currentReadingKwh: 1300,
      billingDays: 30,
      lineItems: [
        {
          description: "Consumo TE",
          quantity: 300,
          unitRate: 0.98,
          amount: 294,
        },
        {
          description: "ICMS",
          quantity: 294,
          unitRate: 0.18,
          amount: 52.92,
        },
      ],
    });

    const findings = await applyBillRules(bill.id);

    expect(findings).toEqual([]);
  });

  it("only evaluates the consumption anomaly once the UC has prior history", async () => {
    const first = await createDoneBill({
      tariffFlag: "verde",
      appliedKwhRate: 0.98,
      consumptionKwh: 300,
    });
    const firstFindings = await applyBillRules(first.id);
    expect(
      firstFindings.some((f) => f.ruleCode === "reading.consumption_anomaly"),
    ).toBe(false);

    const second = await createDoneBill({
      referenceMonth: MONTH_2,
      appliedKwhRate: 0.98,
      consumptionKwh: 900,
    });
    const secondFindings = await applyBillRules(second.id);
    expect(
      secondFindings.some((f) => f.ruleCode === "reading.consumption_anomaly"),
    ).toBe(true);
  });
});
