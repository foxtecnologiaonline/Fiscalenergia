import type { Bill, HouseholdAppliance } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  applyWasteRules,
  checkPersistentUnidentifiedConsumption,
  checkUnexplainedConsumptionJump,
} from "@/lib/rules/waste";

type RecentBill = Pick<Bill, "referenceMonth" | "consumptionKwh">;

function bill(referenceMonth: string, consumptionKwh: number | null): RecentBill {
  return { referenceMonth: new Date(`${referenceMonth}-01T00:00:00.000Z`), consumptionKwh };
}

function applianceCreatedAt(iso: string): Pick<HouseholdAppliance, "createdAt"> {
  return { createdAt: new Date(iso) };
}

describe("checkPersistentUnidentifiedConsumption", () => {
  it("does not flag with fewer than 2 recent bills", () => {
    expect(
      checkPersistentUnidentifiedConsumption([bill("2026-03", 500)], 100),
    ).toEqual([]);
  });

  it("does not flag a single month of gap (the most recent only)", () => {
    // Gap grande só no mês mais recente; mês anterior está dentro do
    // esperado -> não é persistente.
    const bills = [bill("2026-03", 500), bill("2026-02", 120)];
    expect(checkPersistentUnidentifiedConsumption(bills, 100)).toEqual([]);
  });

  it("flags a gap that persists across 2 consecutive months", () => {
    const bills = [bill("2026-03", 500), bill("2026-02", 480)];
    const findings = checkPersistentUnidentifiedConsumption(bills, 100);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleCode).toBe(
      "waste.unidentified_consumption_persistent",
    );
  });

  it("does not flag when the two most recent bills are not consecutive months", () => {
    const bills = [bill("2026-04", 500), bill("2026-02", 480)];
    expect(checkPersistentUnidentifiedConsumption(bills, 100)).toEqual([]);
  });

  it("does not flag when consumptionKwh is missing", () => {
    const bills = [bill("2026-03", null), bill("2026-02", 480)];
    expect(checkPersistentUnidentifiedConsumption(bills, 100)).toEqual([]);
  });
});

describe("checkUnexplainedConsumptionJump", () => {
  it("does not flag with fewer than 2 recent bills", () => {
    expect(
      checkUnexplainedConsumptionJump([bill("2026-03", 500)], []),
    ).toEqual([]);
  });

  it("does not flag a normal month-to-month variation", () => {
    const bills = [bill("2026-03", 320), bill("2026-02", 300)];
    expect(checkUnexplainedConsumptionJump(bills, [])).toEqual([]);
  });

  it("flags a large jump with no new appliance registered in the window", () => {
    const bills = [bill("2026-03", 500), bill("2026-02", 300)];
    const findings = checkUnexplainedConsumptionJump(bills, [
      applianceCreatedAt("2026-01-15T00:00:00.000Z"),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleCode).toBe("waste.unexplained_consumption_jump");
  });

  it("does not flag when a new appliance explains the jump", () => {
    const bills = [bill("2026-03", 500), bill("2026-02", 300)];
    const findings = checkUnexplainedConsumptionJump(bills, [
      applianceCreatedAt("2026-02-15T00:00:00.000Z"),
    ]);
    expect(findings).toEqual([]);
  });

  it("does not flag when the new appliance was registered mid-way through the billed month itself", () => {
    // referenceMonth da fatura de março é sempre meia-noite UTC do dia 1
    // — um aparelho cadastrado em qualquer outro dia de março (o caso
    // comum: compra o aparelho e só depois a fatura daquele mês chega)
    // precisa continuar explicando o salto.
    const bills = [bill("2026-03", 500), bill("2026-02", 300)];
    const findings = checkUnexplainedConsumptionJump(bills, [
      applianceCreatedAt("2026-03-10T00:00:00.000Z"),
    ]);
    expect(findings).toEqual([]);
  });

  it("does not flag when the previous bill had zero consumption", () => {
    const bills = [bill("2026-03", 500), bill("2026-02", 0)];
    expect(checkUnexplainedConsumptionJump(bills, [])).toEqual([]);
  });
});

describe("applyWasteRules", () => {
  it("produces no findings for stable, well-explained consumption", () => {
    const bills = [bill("2026-03", 310), bill("2026-02", 300)];
    expect(applyWasteRules(bills, [], 290)).toEqual([]);
  });
});
