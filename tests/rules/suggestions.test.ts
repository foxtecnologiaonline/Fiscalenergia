import type { ApplianceCatalog, Finding, HouseholdAppliance } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  checkOutdatedOrUnmaintained,
  type ApplianceWithCatalog,
} from "@/lib/rules/appliance-efficiency";
import { buildSuggestion } from "@/lib/rules/suggestions";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "finding-1",
    consumerUnitId: "unit-1",
    billId: null,
    type: "billing_error",
    ruleCode: "billing.kwh_rate_mismatch",
    severity: "medium",
    description: "A tarifa de kWh cobrada diverge da tarifa homologada.",
    estimatedImpactAmount: 42,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("buildSuggestion", () => {
  it("returns null for a finding with no associated action (ranking)", () => {
    const finding = makeFinding({
      type: "top_consumer",
      ruleCode: "ranking.top_consumers",
      description: "Os aparelhos que mais consomem nesta UC são: Geladeira (Cozinha, 40%).",
    });
    expect(buildSuggestion(finding)).toBeNull();
  });

  it("builds a suggestion carrying the finding's estimated impact", () => {
    const finding = makeFinding();
    const suggestion = buildSuggestion(finding);
    expect(suggestion).not.toBeNull();
    expect(suggestion?.ruleCode).toBe("billing.kwh_rate_mismatch");
    expect(suggestion?.title).toBe("Contestar tarifa de kWh cobrada incorretamente");
    expect(suggestion?.estimatedSavingsAmount).toBe(42);
    expect(suggestion?.applianceSubject).toBeNull();
  });

  it("returns null estimatedSavingsAmount when the finding has no impact", () => {
    const finding = makeFinding({ estimatedImpactAmount: null });
    expect(buildSuggestion(finding)?.estimatedSavingsAmount).toBeNull();
  });

  it("parses the appliance name/room and embeds it in the title for appliance findings", () => {
    const finding = makeFinding({
      type: "appliance_inefficiency",
      ruleCode: "appliance.above_reference_consumption",
      description:
        "Geladeira (Cozinha): consumo estimado de 96.0 kWh/mês está 167% acima do esperado para esse tipo de aparelho.",
      estimatedImpactAmount: 60,
    });
    const suggestion = buildSuggestion(finding);
    expect(suggestion?.applianceSubject).toEqual({ name: "Geladeira", room: "Cozinha" });
    expect(suggestion?.title).toBe(
      "Verificar aparelho com consumo acima do esperado — Geladeira (Cozinha)",
    );
  });

  it("produces distinct titles for two different appliances triggering the same rule", () => {
    const fridge = makeFinding({
      type: "appliance_inefficiency",
      ruleCode: "appliance.above_reference_consumption",
      description: "Geladeira (Cozinha): consumo estimado ...",
    });
    const freezer = makeFinding({
      id: "finding-2",
      type: "appliance_inefficiency",
      ruleCode: "appliance.above_reference_consumption",
      description: "Freezer (Cozinha): consumo estimado ...",
    });
    const fridgeSuggestion = buildSuggestion(fridge);
    const freezerSuggestion = buildSuggestion(freezer);
    expect(fridgeSuggestion?.title).not.toBe(freezerSuggestion?.title);
  });

  it("returns a generic title (no appliance subject) for waste findings", () => {
    const finding = makeFinding({
      type: "possible_waste_or_loss",
      ruleCode: "waste.unexplained_consumption_jump",
      description: "O consumo faturado subiu 60% em relação ao mês anterior...",
      estimatedImpactAmount: null,
    });
    const suggestion = buildSuggestion(finding);
    expect(suggestion?.applianceSubject).toBeNull();
    expect(suggestion?.title).toBe(
      "Investigar aumento de consumo sem causa aparente",
    );
  });

  it("returns null for an unmapped rule code", () => {
    const finding = makeFinding({ ruleCode: "unknown.rule" });
    expect(buildSuggestion(finding)).toBeNull();
  });

  // Teste de integração entre appliance-efficiency.ts e suggestions.ts:
  // garante que a descrição de CADA regra de aparelho realmente usada em
  // produção segue o formato "Nome (Cômodo): ..." que o regex de
  // suggestions.ts espera — e não apenas uma string escrita à mão no
  // teste, que poderia ficar dessincronizada do formato real sem que
  // nenhum teste percebesse (foi exatamente isso que aconteceu com a
  // regra 9: a descrição não tinha o ":" e duas geladeiras antigas
  // diferentes colidiam na mesma Suggestion).
  function makeApplianceWithCatalog(
    overrides: Partial<HouseholdAppliance> = {},
    catalog: ApplianceCatalog | null = null,
  ): ApplianceWithCatalog {
    return {
      id: "appliance-1",
      consumerUnitId: "unit-1",
      catalogId: null,
      name: "Geladeira",
      room: "Cozinha",
      powerW: 150,
      usageHoursPerDay: 8,
      usageDaysPerWeek: 7,
      quantity: 1,
      ageYears: null,
      lastMaintenanceAt: null,
      condition: "antigo",
      isCustom: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      catalog,
      ...overrides,
    };
  }

  it("extracts a per-appliance subject from the real appliance.outdated_or_unmaintained description", () => {
    const [finding] = checkOutdatedOrUnmaintained(
      makeApplianceWithCatalog({ condition: "antigo" }),
      100, // totalEstimatedKwh -> 36/100 = 36% > 15% threshold
    );
    expect(finding).toBeDefined();

    const suggestion = buildSuggestion({ ...makeFinding(), ...finding });
    expect(suggestion?.applianceSubject).toEqual({
      name: "Geladeira",
      room: "Cozinha",
    });
  });

  it("gives two different outdated appliances distinct suggestion titles (no silent overwrite)", () => {
    const [fridgeFinding] = checkOutdatedOrUnmaintained(
      makeApplianceWithCatalog({ name: "Geladeira", condition: "antigo" }),
      100,
    );
    const [freezerFinding] = checkOutdatedOrUnmaintained(
      makeApplianceWithCatalog({ name: "Freezer", condition: "sem_manutencao" }),
      100,
    );

    const fridgeSuggestion = buildSuggestion({ ...makeFinding(), ...fridgeFinding });
    const freezerSuggestion = buildSuggestion({ ...makeFinding(), ...freezerFinding });

    expect(fridgeSuggestion?.title).not.toBe(freezerSuggestion?.title);
  });
});
