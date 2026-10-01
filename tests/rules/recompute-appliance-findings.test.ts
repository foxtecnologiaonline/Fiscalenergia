// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { recomputeApplianceFindingsAndSuggestions } from "@/lib/rules/recompute-appliance-findings";

const TEST_EMAIL_MARKER = "recompute-appliance-findings-test";
const TEST_DISTRIBUTOR = "Test Distribuidora Recompute";

describe("recomputeApplianceFindingsAndSuggestions", () => {
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
      where: { room: "cozinha", name: "Geladeira de teste recompute" },
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
        code: "UC-RECOMPUTE-1",
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
        category: "refrigeracao",
        name: "Geladeira de teste recompute",
        typicalPowerW: 400,
        typicalUsageHoursPerDay: 8,
        typicalUsageDaysPerWeek: 7,
      },
    });
    catalogId = catalog.id;

    await db.householdAppliance.createMany({
      data: [
        {
          consumerUnitId: unitId,
          catalogId,
          name: "Geladeira de teste recompute",
          room: "Cozinha",
          powerW: 400,
          usageHoursPerDay: 8,
          usageDaysPerWeek: 7,
          quantity: 1,
          condition: "antigo",
          isCustom: false,
        },
        {
          consumerUnitId: unitId,
          name: "Ar-condicionado recompute",
          room: "Quarto 1",
          powerW: 100,
          usageHoursPerDay: 1,
          usageDaysPerWeek: 1,
          quantity: 1,
          isCustom: true,
        },
      ],
    });
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_MARKER } },
    });
    await db.$disconnect();
  });

  // Reproduz o cenário do clique em "Salvar cômodo" (components/appliances/
  // room-form.tsx), que dispara N requisições em paralelo para a mesma UC —
  // cada uma recalculando achados de aparelho e regenerando Suggestions.
  // Antes da correção, o delete+recreate de achados de uma chamada podia
  // apagar o Finding que outra chamada acabara de ler, e o upsert de
  // Suggestion desta última falhava com violação de chave estrangeira
  // (Suggestion_findingId_fkey). O advisory lock por UC deve eliminar esse
  // erro por completo, mesmo sob concorrência real.
  it("survives several concurrent calls for the same UC without a foreign key violation", async () => {
    const results = await Promise.allSettled([
      recomputeApplianceFindingsAndSuggestions(unitId),
      recomputeApplianceFindingsAndSuggestions(unitId),
      recomputeApplianceFindingsAndSuggestions(unitId),
    ]);

    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    expect(failures).toEqual([]);

    const suggestions = await db.suggestion.findMany({
      where: { consumerUnitId: unitId },
    });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      if (suggestion.findingId) {
        const finding = await db.finding.findUnique({
          where: { id: suggestion.findingId },
        });
        expect(finding).not.toBeNull();
      }
    }
  });

  it("regenerates suggestions consistent with the current appliance findings on a single call", async () => {
    const findings = await recomputeApplianceFindingsAndSuggestions(unitId);
    expect(findings.length).toBeGreaterThan(0);

    const suggestions = await db.suggestion.findMany({
      where: { consumerUnitId: unitId },
    });
    expect(suggestions.length).toBeGreaterThan(0);
  });
});
