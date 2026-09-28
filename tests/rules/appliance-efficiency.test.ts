import type { ApplianceCatalog, HouseholdAppliance } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  applyApplianceEfficiencyRules,
  checkAboveReferenceConsumption,
  checkAboveTypicalUsage,
  checkOutdatedOrUnmaintained,
  type ApplianceWithCatalog,
} from "@/lib/rules/appliance-efficiency";

function makeCatalog(overrides: Partial<ApplianceCatalog> = {}): ApplianceCatalog {
  return {
    id: "catalog-1",
    name: "Geladeira",
    category: "Refrigeração",
    room: "cozinha",
    typicalPowerW: 150,
    typicalUsageHoursPerDay: 8,
    typicalUsageDaysPerWeek: 7,
    referenceKwhMonth: 36,
    notes: null,
    ...overrides,
  };
}

function makeAppliance(
  overrides: Partial<HouseholdAppliance> = {},
  catalog: ApplianceCatalog | null = makeCatalog(),
): ApplianceWithCatalog {
  return {
    id: "appliance-1",
    consumerUnitId: "unit-1",
    catalogId: catalog?.id ?? null,
    name: "Geladeira",
    room: "Cozinha",
    powerW: 150,
    usageHoursPerDay: 8,
    usageDaysPerWeek: 7,
    quantity: 1,
    ageYears: null,
    lastMaintenanceAt: null,
    condition: "normal",
    isCustom: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    catalog,
    ...overrides,
  };
}

describe("checkAboveReferenceConsumption", () => {
  it("does not flag an appliance without a catalog reference", () => {
    const appliance = makeAppliance({}, null);
    expect(checkAboveReferenceConsumption(appliance, 1)).toEqual([]);
  });

  it("does not flag consumption within the adjusted reference", () => {
    const appliance = makeAppliance({ powerW: 150 });
    expect(checkAboveReferenceConsumption(appliance, 1)).toEqual([]);
  });

  it("flags consumption well above the reference", () => {
    // 400W * 8h * 7/7 * 30 / 1000 = 96 kWh, vs referência 36 kWh -> muito acima
    const appliance = makeAppliance({ powerW: 400 });
    const findings = checkAboveReferenceConsumption(appliance, 1);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleCode).toBe("appliance.above_reference_consumption");
    expect(findings[0].severity).toBe("high");
  });

  it("raises the tolerance for an old, unmaintained appliance", () => {
    // 45 kWh estaria acima da referência crua (36), mas dentro da
    // tolerância ajustada por idade (>5 anos) e condição sem_manutencao.
    const appliance = makeAppliance({
      powerW: 187.5, // 187.5 * 8 * 1 * 30 / 1000 = 45
      condition: "sem_manutencao",
      ageYears: 10,
    });
    expect(checkAboveReferenceConsumption(appliance, 1)).toEqual([]);
  });

  it("computes estimatedImpactAmount from the kWh rate when provided", () => {
    const appliance = makeAppliance({ powerW: 400 });
    const findings = checkAboveReferenceConsumption(appliance, 2);
    expect(findings[0].estimatedImpactAmount).toBeCloseTo((96 - 36) * 2, 5);
  });

  it("returns null estimatedImpactAmount when no kWh rate is known", () => {
    const appliance = makeAppliance({ powerW: 400 });
    const findings = checkAboveReferenceConsumption(appliance, null);
    expect(findings[0].estimatedImpactAmount).toBeNull();
  });
});

describe("checkOutdatedOrUnmaintained", () => {
  it("does not flag a normal-condition appliance", () => {
    const appliance = makeAppliance({ condition: "normal" });
    expect(checkOutdatedOrUnmaintained(appliance, 100)).toEqual([]);
  });

  it("does not flag an old appliance with a small share of total consumption", () => {
    const appliance = makeAppliance({ condition: "antigo" }); // 36 kWh
    expect(checkOutdatedOrUnmaintained(appliance, 1000)).toEqual([]);
  });

  it("flags an old appliance representing a relevant share of total consumption", () => {
    const appliance = makeAppliance({ condition: "antigo" }); // 36 kWh
    const findings = checkOutdatedOrUnmaintained(appliance, 100); // 36%
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleCode).toBe("appliance.outdated_or_unmaintained");
  });

  it("does not flag when there is no total consumption to compare against", () => {
    const appliance = makeAppliance({ condition: "sem_manutencao" });
    expect(checkOutdatedOrUnmaintained(appliance, 0)).toEqual([]);
  });
});

describe("checkAboveTypicalUsage", () => {
  it("does not flag without a catalog reference", () => {
    const appliance = makeAppliance({}, null);
    expect(checkAboveTypicalUsage(appliance, 1)).toEqual([]);
  });

  it("does not flag usage within the typical range", () => {
    const appliance = makeAppliance({ usageHoursPerDay: 9 });
    expect(checkAboveTypicalUsage(appliance, 1)).toEqual([]);
  });

  it("flags usage well above the typical range", () => {
    const appliance = makeAppliance({ usageHoursPerDay: 20 }); // catálogo: 8h
    const findings = checkAboveTypicalUsage(appliance, 1);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleCode).toBe("appliance.above_typical_usage");
    expect(findings[0].severity).toBe("high");
  });
});

describe("applyApplianceEfficiencyRules", () => {
  it("produces no findings for a typical, well-maintained appliance", () => {
    const appliance = makeAppliance();
    expect(applyApplianceEfficiencyRules([appliance], 36, 1)).toEqual([]);
  });

  it("combines findings across multiple appliances", () => {
    // 20h/dia dispara tanto a regra 10 (uso acima do típico) quanto a
    // regra 8 (o uso extra também eleva o consumo estimado bem acima da
    // referência do catálogo).
    const highUsage = makeAppliance({
      id: "appliance-2",
      usageHoursPerDay: 20,
    });
    const normal = makeAppliance({ id: "appliance-3" });
    const findings = applyApplianceEfficiencyRules(
      [highUsage, normal],
      72,
      1,
    );
    const ruleCodes = findings.map((f) => f.ruleCode).sort();
    expect(ruleCodes).toEqual([
      "appliance.above_reference_consumption",
      "appliance.above_typical_usage",
    ]);
  });
});
