// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { applyApplianceRules } from "@/lib/rules/apply-appliance-rules";

const TEST_EMAIL_MARKER = "apply-appliance-rules-test";
const TEST_DISTRIBUTOR = "Test Distribuidora Aparelhos";
const MONTH_1 = new Date("2031-01-01T00:00:00.000Z");
const MONTH_2 = new Date("2031-02-01T00:00:00.000Z");

describe("applyApplianceRules", () => {
  let unitId: string;
  let catalogId: string;

  beforeEach(async () => {
    await db.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_MARKER } },
    });
    await db.tariffReference.deleteMany({
      where: { distributor: TEST_DISTRIBUTOR },
    });
    await db.applianceCatalog.deleteMany({
      where: { room: "cozinha", name: "Geladeira de teste" },
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
        code: "UC-APPLIANCE-RULES-1",
        distributor: TEST_DISTRIBUTOR,
        uf: "SP",
        city: "São Paulo",
        tariffGroup: "B",
        tariffSubgroup: "B1",
        tariffModality: "Convencional",
      },
    });
    unitId = unit.id;

    await db.tariffReference.create({
      data: {
        distributor: TEST_DISTRIBUTOR,
        uf: "SP",
        tariffGroup: "B",
        tariffSubgroup: "B1",
        validFrom: new Date("2020-01-01T00:00:00.000Z"),
        validTo: null,
        kwhRate: 1,
        icmsRate: 0.18,
      },
    });

    const catalog = await db.applianceCatalog.create({
      data: {
        room: "cozinha",
        name: "Geladeira de teste",
        category: "Refrigeração",
        typicalPowerW: 150,
        typicalUsageHoursPerDay: 8,
        typicalUsageDaysPerWeek: 7,
        referenceKwhMonth: 36,
      },
    });
    catalogId = catalog.id;
  });

  afterAll(async () => {
    await db.tariffReference.deleteMany({
      where: { distributor: TEST_DISTRIBUTOR },
    });
    await db.applianceCatalog.deleteMany({
      where: { room: "cozinha", name: "Geladeira de teste" },
    });
    await db.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_MARKER } },
    });
    await db.$disconnect();
  });

  it("creates an efficiency finding for an appliance far above its catalog reference", async () => {
    await db.householdAppliance.create({
      data: {
        consumerUnitId: unitId,
        catalogId,
        name: "Geladeira de teste",
        room: "Cozinha",
        powerW: 400,
        usageHoursPerDay: 8,
        usageDaysPerWeek: 7,
        quantity: 1,
        condition: "normal",
        isCustom: false,
      },
    });

    const findings = await applyApplianceRules(unitId);

    expect(
      findings.some(
        (f) => f.ruleCode === "appliance.above_reference_consumption",
      ),
    ).toBe(true);
    expect(
      findings.some((f) => f.type === "top_consumer"),
    ).toBe(true);
  });

  it("produces no findings for a single typical, well-maintained appliance", async () => {
    await db.householdAppliance.create({
      data: {
        consumerUnitId: unitId,
        catalogId,
        name: "Geladeira de teste",
        room: "Cozinha",
        powerW: 150,
        usageHoursPerDay: 8,
        usageDaysPerWeek: 7,
        quantity: 1,
        condition: "normal",
        isCustom: false,
      },
    });

    const findings = await applyApplianceRules(unitId);

    // Único aparelho cadastrado -> a regra de ranking ainda destaca o
    // "top consumidor", mas nenhuma regra de ineficiência/desperdício.
    expect(
      findings.filter((f) => f.type !== "top_consumer"),
    ).toEqual([]);
  });

  it("replaces the previous appliance-derived findings on each call (no accumulation)", async () => {
    await db.householdAppliance.create({
      data: {
        consumerUnitId: unitId,
        catalogId,
        name: "Geladeira de teste",
        room: "Cozinha",
        powerW: 400,
        usageHoursPerDay: 8,
        usageDaysPerWeek: 7,
        quantity: 1,
        condition: "normal",
        isCustom: false,
      },
    });

    const first = await applyApplianceRules(unitId);
    expect(first.length).toBeGreaterThan(0);

    // Remove o aparelho e roda de novo: os achados antigos não devem
    // sobreviver (senão apareceriam para sempre, mesmo sem o aparelho).
    await db.householdAppliance.deleteMany({ where: { consumerUnitId: unitId } });
    const second = await applyApplianceRules(unitId);
    expect(second).toEqual([]);

    const stored = await db.finding.findMany({
      where: { consumerUnitId: unitId, billId: null },
    });
    expect(stored).toEqual([]);
  });

  it("never touches bill-scoped findings (billId set)", async () => {
    const bill = await db.bill.create({
      data: {
        consumerUnitId: unitId,
        referenceMonth: MONTH_1,
        fileUrl: "https://blob.example.com/fake.pdf",
        status: "done",
      },
    });
    await db.finding.create({
      data: {
        consumerUnitId: unitId,
        billId: bill.id,
        type: "billing_error",
        ruleCode: "billing.tariff_flag_mismatch",
        severity: "medium",
        description: "achado de fatura, não deve ser tocado",
      },
    });

    await applyApplianceRules(unitId);

    const billFinding = await db.finding.findFirst({
      where: { billId: bill.id },
    });
    expect(billFinding).not.toBeNull();
  });

  it("flags a persistent unidentified consumption gap across 2 consecutive months", async () => {
    await db.bill.create({
      data: {
        consumerUnitId: unitId,
        referenceMonth: MONTH_1,
        fileUrl: "https://blob.example.com/fake.pdf",
        status: "done",
        consumptionKwh: 500,
      },
    });
    await db.bill.create({
      data: {
        consumerUnitId: unitId,
        referenceMonth: MONTH_2,
        fileUrl: "https://blob.example.com/fake.pdf",
        status: "done",
        consumptionKwh: 480,
      },
    });
    // Sem aparelhos cadastrados -> soma estimada é 0, então 100% do
    // consumo faturado fica sem explicação nos dois meses.

    const findings = await applyApplianceRules(unitId);

    expect(
      findings.some(
        (f) => f.ruleCode === "waste.unidentified_consumption_persistent",
      ),
    ).toBe(true);
  });
});
