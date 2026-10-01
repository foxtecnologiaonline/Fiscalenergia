// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { evaluateAppliedSuggestions } from "@/lib/rules/evaluate-suggestions";

const TEST_EMAIL_MARKER = "evaluate-suggestions-test";
const TEST_DISTRIBUTOR = "Test Distribuidora Avaliação";
const MONTH_1 = new Date("2032-01-01T00:00:00.000Z");
const MONTH_2 = new Date("2032-02-01T00:00:00.000Z");

describe("evaluateAppliedSuggestions", () => {
  let unitId: string;

  beforeEach(async () => {
    await db.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_MARKER } },
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
        code: "UC-EVAL-1",
        distributor: TEST_DISTRIBUTOR,
        uf: "SP",
        city: "São Paulo",
        tariffGroup: "B",
        tariffSubgroup: "B1",
        tariffModality: "Convencional",
      },
    });
    unitId = unit.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_MARKER } },
    });
    await db.$disconnect();
  });

  async function createBill(referenceMonth: Date, consumptionKwh: number, totalAmount: number) {
    return db.bill.create({
      data: {
        consumerUnitId: unitId,
        referenceMonth,
        fileUrl: "https://blob.example.com/fake.pdf",
        status: "done",
        consumptionKwh,
        totalAmount,
      },
    });
  }

  async function createAppliedSuggestion(baselineBillId: string) {
    return db.suggestion.create({
      data: {
        consumerUnitId: unitId,
        ruleCode: "appliance.above_reference_consumption",
        title: "Verificar aparelho com consumo acima do esperado — Geladeira (Cozinha)",
        description: "Geladeira (Cozinha): consumo estimado muito acima do esperado.",
        status: "applied",
        appliedAt: new Date(),
        appliedNote: "Troquei a geladeira",
        baselineBillId,
      },
    });
  }

  it("evaluates an applied suggestion against the follow-up bill", async () => {
    const baseline = await createBill(MONTH_1, 500, 500);
    const suggestion = await createAppliedSuggestion(baseline.id);
    const followUp = await createBill(MONTH_2, 400, 400);

    const evaluated = await evaluateAppliedSuggestions(unitId, followUp);

    expect(evaluated).toHaveLength(1);
    expect(evaluated[0].id).toBe(suggestion.id);
    expect(evaluated[0].followUpBillId).toBe(followUp.id);
    expect(evaluated[0].actualSavingsKwh).toBe(100);
    expect(evaluated[0].actualSavingsAmount).toBe(100);
    expect(evaluated[0].evaluatedAt).not.toBeNull();
  });

  it("does not evaluate a suggestion that is not applied", async () => {
    const baseline = await createBill(MONTH_1, 500, 500);
    await db.suggestion.create({
      data: {
        consumerUnitId: unitId,
        ruleCode: "billing.kwh_rate_mismatch",
        title: "Contestar tarifa de kWh cobrada incorretamente",
        description: "A tarifa cobrada diverge da homologada.",
        status: "suggested",
        baselineBillId: baseline.id,
      },
    });
    const followUp = await createBill(MONTH_2, 400, 400);

    expect(await evaluateAppliedSuggestions(unitId, followUp)).toEqual([]);
  });

  it("does not re-evaluate a suggestion that already has a followUpBillId", async () => {
    const baseline = await createBill(MONTH_1, 500, 500);
    const firstFollowUp = await createBill(MONTH_2, 450, 450);
    await db.suggestion.create({
      data: {
        consumerUnitId: unitId,
        ruleCode: "appliance.above_reference_consumption",
        title: "Verificar aparelho com consumo acima do esperado — Geladeira (Cozinha)",
        description: "Geladeira (Cozinha): consumo estimado muito acima do esperado.",
        status: "applied",
        appliedAt: new Date(),
        baselineBillId: baseline.id,
        followUpBillId: firstFollowUp.id,
        actualSavingsKwh: 50,
        evaluatedAt: new Date(),
      },
    });
    const secondFollowUp = await createBill(
      new Date("2032-03-01T00:00:00.000Z"),
      440,
      440,
    );

    expect(await evaluateAppliedSuggestions(unitId, secondFollowUp)).toEqual([]);
  });

  it("gives the same aggregate delta to two suggestions sharing the same baseline (combined-effect limitation)", async () => {
    const baseline = await createBill(MONTH_1, 500, 500);
    await createAppliedSuggestion(baseline.id);
    await db.suggestion.create({
      data: {
        consumerUnitId: unitId,
        ruleCode: "waste.unexplained_consumption_jump",
        title: "Investigar aumento de consumo sem causa aparente",
        description: "O consumo faturado subiu sem causa aparente.",
        status: "applied",
        appliedAt: new Date(),
        baselineBillId: baseline.id,
      },
    });
    const followUp = await createBill(MONTH_2, 380, 380);

    const evaluated = await evaluateAppliedSuggestions(unitId, followUp);
    expect(evaluated).toHaveLength(2);
    expect(evaluated[0].actualSavingsKwh).toBe(120);
    expect(evaluated[1].actualSavingsKwh).toBe(120);
  });

  it("does not evaluate against an older, out-of-order follow-up bill", async () => {
    // Fatura de fevereiro já serviu de baseline; o usuário depois envia
    // (fora de ordem) a fatura de janeiro, que faltava. Essa fatura mais
    // antiga nunca deve ser tratada como follow-up — a "economia" não
    // faria sentido e ficaria travada para sempre.
    const baseline = await createBill(MONTH_2, 400, 400);
    const suggestion = await createAppliedSuggestion(baseline.id);
    const olderBill = await createBill(MONTH_1, 500, 500);

    expect(await evaluateAppliedSuggestions(unitId, olderBill)).toEqual([]);

    const stored = await db.suggestion.findUnique({ where: { id: suggestion.id } });
    expect(stored?.followUpBillId).toBeNull();
    expect(stored?.evaluatedAt).toBeNull();
  });

  it("does not evaluate against a follow-up bill for the same reference month as the baseline", async () => {
    const baseline = await createBill(MONTH_1, 500, 500);
    const suggestion = await createAppliedSuggestion(baseline.id);
    const sameMonthBill = await createBill(MONTH_1, 450, 450);

    expect(await evaluateAppliedSuggestions(unitId, sameMonthBill)).toEqual([]);

    const stored = await db.suggestion.findUnique({ where: { id: suggestion.id } });
    expect(stored?.evaluatedAt).toBeNull();
  });

  it("does not evaluate when there is no baseline bill", async () => {
    await db.suggestion.create({
      data: {
        consumerUnitId: unitId,
        ruleCode: "billing.kwh_rate_mismatch",
        title: "Contestar tarifa de kWh cobrada incorretamente",
        description: "A tarifa cobrada diverge da homologada.",
        status: "applied",
        appliedAt: new Date(),
      },
    });
    const followUp = await createBill(MONTH_2, 400, 400);

    expect(await evaluateAppliedSuggestions(unitId, followUp)).toEqual([]);
  });
});
