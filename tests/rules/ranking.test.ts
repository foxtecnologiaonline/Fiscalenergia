import type { HouseholdAppliance } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { applyRankingRule } from "@/lib/rules/ranking";

function makeAppliance(
  overrides: Partial<HouseholdAppliance> = {},
): HouseholdAppliance {
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
    condition: "normal",
    isCustom: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("applyRankingRule", () => {
  it("produces no findings with no appliances", () => {
    expect(applyRankingRule([], 0)).toEqual([]);
  });

  it("produces no findings when total estimated consumption is zero", () => {
    const appliance = makeAppliance({ quantity: 0 });
    expect(applyRankingRule([appliance], 0)).toEqual([]);
  });

  it("highlights the top consumer with a single appliance", () => {
    const appliance = makeAppliance(); // 36 kWh
    const findings = applyRankingRule([appliance], 36);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleCode).toBe("ranking.top_consumers");
    expect(findings[0].description).toContain("Geladeira");
    expect(findings[0].description).toContain("100%");
  });

  it("ranks and limits to the top 3 appliances by estimated consumption", () => {
    const appliances = [
      makeAppliance({ id: "a1", name: "Chuveiro elétrico", powerW: 5500, usageHoursPerDay: 0.3 }),
      makeAppliance({ id: "a2", name: "Geladeira", powerW: 150, usageHoursPerDay: 8 }),
      makeAppliance({ id: "a3", name: "Ar-condicionado", powerW: 900, usageHoursPerDay: 6 }),
      makeAppliance({ id: "a4", name: "Carregador de celular", powerW: 10, usageHoursPerDay: 2 }),
    ];
    const total = appliances.reduce(
      (sum, a) => sum + (a.powerW * a.usageHoursPerDay * (a.usageDaysPerWeek / 7) * 30) / 1000,
      0,
    );
    const findings = applyRankingRule(appliances, total);
    expect(findings).toHaveLength(1);
    expect(findings[0].description).not.toContain("Carregador de celular");
    expect(findings[0].description).toContain("Ar-condicionado");
  });

  it("excludes appliances with zero estimated consumption from the ranking", () => {
    const zeroUsage = makeAppliance({ id: "a1", quantity: 0 });
    const normal = makeAppliance({ id: "a2" });
    const findings = applyRankingRule([zeroUsage, normal], 36);
    expect(findings[0].description).not.toMatch(/Geladeira.*Geladeira/);
  });
});
