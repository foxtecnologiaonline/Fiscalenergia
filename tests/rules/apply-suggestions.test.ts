// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { applySuggestions } from "@/lib/rules/apply-suggestions";

const TEST_EMAIL_MARKER = "apply-suggestions-test";
const TEST_DISTRIBUTOR = "Test Distribuidora Sugestões";

describe("applySuggestions", () => {
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
        code: "UC-SUGGESTIONS-1",
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

  it("creates a suggestion from a relevant finding", async () => {
    await db.finding.create({
      data: {
        consumerUnitId: unitId,
        type: "billing_error",
        ruleCode: "billing.kwh_rate_mismatch",
        severity: "medium",
        description: "A tarifa cobrada diverge da homologada.",
        estimatedImpactAmount: 30,
      },
    });

    const suggestions = await applySuggestions(unitId);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].status).toBe("suggested");
    expect(suggestions[0].estimatedSavingsAmount).toBe(30);
  });

  it("does not create a suggestion for a finding with no mapped action (ranking)", async () => {
    await db.finding.create({
      data: {
        consumerUnitId: unitId,
        type: "top_consumer",
        ruleCode: "ranking.top_consumers",
        severity: "low",
        description: "Os aparelhos que mais consomem nesta UC são: Geladeira (Cozinha, 100%).",
      },
    });

    const suggestions = await applySuggestions(unitId);
    expect(suggestions).toEqual([]);
  });

  it("resolves householdApplianceId when the finding names a registered appliance", async () => {
    const appliance = await db.householdAppliance.create({
      data: {
        consumerUnitId: unitId,
        name: "Geladeira",
        room: "Cozinha",
        powerW: 400,
        usageHoursPerDay: 8,
        usageDaysPerWeek: 7,
        quantity: 1,
        isCustom: true,
      },
    });
    await db.finding.create({
      data: {
        consumerUnitId: unitId,
        type: "appliance_inefficiency",
        ruleCode: "appliance.above_reference_consumption",
        severity: "high",
        description: "Geladeira (Cozinha): consumo estimado de 96.0 kWh/mês está muito acima do esperado.",
        estimatedImpactAmount: 60,
      },
    });

    const suggestions = await applySuggestions(unitId);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].householdApplianceId).toBe(appliance.id);
  });

  it("refreshes the estimate on re-run without resetting an already-applied status", async () => {
    const finding = await db.finding.create({
      data: {
        consumerUnitId: unitId,
        type: "billing_error",
        ruleCode: "billing.kwh_rate_mismatch",
        severity: "medium",
        description: "A tarifa cobrada diverge da homologada.",
        estimatedImpactAmount: 30,
      },
    });
    const [firstRun] = await applySuggestions(unitId);
    await db.suggestion.update({
      where: { id: firstRun.id },
      data: {
        status: "applied",
        appliedAt: new Date(),
        appliedNote: "Liguei para a distribuidora",
      },
    });

    // O achado é substituído (billId nulo não se aplica aqui, mas o
    // padrão de recomputo da Fase 6 também vale para achados de fatura
    // recriados manualmente neste teste) com um valor de impacto novo.
    await db.finding.update({
      where: { id: finding.id },
      data: { estimatedImpactAmount: 55 },
    });

    const secondRun = await applySuggestions(unitId);
    expect(secondRun).toHaveLength(1);
    expect(secondRun[0].id).toBe(firstRun.id);
    expect(secondRun[0].estimatedSavingsAmount).toBe(55);
    expect(secondRun[0].status).toBe("applied");
    expect(secondRun[0].appliedNote).toBe("Liguei para a distribuidora");
  });

  it("removes a pending (never-applied) suggestion once its finding no longer exists", async () => {
    const finding = await db.finding.create({
      data: {
        consumerUnitId: unitId,
        type: "billing_error",
        ruleCode: "billing.kwh_rate_mismatch",
        severity: "medium",
        description: "A tarifa cobrada diverge da homologada.",
        estimatedImpactAmount: 30,
      },
    });
    const [created] = await applySuggestions(unitId);
    expect(created.status).toBe("suggested");

    // O achado que originou a sugestão não existe mais (ex.: aparelho
    // corrigido, fatura reprocessada sem o erro) — a sugestão pendente
    // correspondente deve sumir, já que não há status aplicado a
    // preservar.
    await db.finding.delete({ where: { id: finding.id } });

    const afterCleanup = await applySuggestions(unitId);
    expect(afterCleanup).toEqual([]);
  });

  it("never removes an already-applied suggestion even if its finding disappears", async () => {
    const finding = await db.finding.create({
      data: {
        consumerUnitId: unitId,
        type: "appliance_inefficiency",
        ruleCode: "appliance.outdated_or_unmaintained",
        severity: "medium",
        description: "Geladeira (Cozinha) está marcada como antiga.",
      },
    });
    const [created] = await applySuggestions(unitId);
    await db.suggestion.update({
      where: { id: created.id },
      data: { status: "applied", appliedAt: new Date(), appliedNote: "Troquei" },
    });

    await db.finding.delete({ where: { id: finding.id } });

    const afterCleanup = await applySuggestions(unitId);
    expect(afterCleanup).toHaveLength(1);
    expect(afterCleanup[0].id).toBe(created.id);
    expect(afterCleanup[0].status).toBe("applied");
    expect(afterCleanup[0].findingId).toBeNull();
  });

  it("creates distinct suggestions for two different appliances triggering the same rule", async () => {
    await db.finding.createMany({
      data: [
        {
          consumerUnitId: unitId,
          type: "appliance_inefficiency",
          ruleCode: "appliance.above_reference_consumption",
          severity: "high",
          description: "Geladeira (Cozinha): consumo estimado muito acima do esperado.",
          estimatedImpactAmount: 60,
        },
        {
          consumerUnitId: unitId,
          type: "appliance_inefficiency",
          ruleCode: "appliance.above_reference_consumption",
          severity: "medium",
          description: "Freezer (Cozinha): consumo estimado muito acima do esperado.",
          estimatedImpactAmount: 40,
        },
      ],
    });

    const suggestions = await applySuggestions(unitId);
    expect(suggestions).toHaveLength(2);
    const titles = suggestions.map((s) => s.title).sort();
    expect(titles[0]).not.toBe(titles[1]);
  });
});
