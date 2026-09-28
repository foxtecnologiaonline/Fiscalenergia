import type { Finding, FindingType } from "@prisma/client";

import { estimateMonthlyKwh } from "@/lib/calculations";
import { db } from "@/lib/db";
import { applyApplianceEfficiencyRules } from "@/lib/rules/appliance-efficiency";
import { applyRankingRule } from "@/lib/rules/ranking";
import { applyWasteRules } from "@/lib/rules/waste";

const RECENT_BILLS_FOR_WASTE_RULES = 2;

const APPLIANCE_DERIVED_TYPES: FindingType[] = [
  "appliance_inefficiency",
  "possible_waste_or_loss",
  "top_consumer",
];

/**
 * Recalcula os achados derivados do estado atual dos aparelhos de uma UC
 * (regras 8-13, ver docs/SCOPE.md seções 5.3-5.5). Ao contrário das regras
 * de fatura (billId != null, calculadas uma única vez por fatura), estas
 * regras avaliam um retrato do estado *atual* da varredura — por isso o
 * conjunto anterior (billId nulo, tipos derivados de aparelho) é
 * substituído inteiro a cada execução, em vez de acumulado. Chamada tanto
 * quando uma fatura termina de processar quanto quando a lista de
 * aparelhos de uma UC muda (ver lib/process-bill.ts e as rotas de
 * app/api/consumer-units/[unitId]/appliances).
 */
export async function applyApplianceRules(
  consumerUnitId: string,
): Promise<Finding[]> {
  const consumerUnit = await db.consumerUnit.findUniqueOrThrow({
    where: { id: consumerUnitId },
  });

  const [appliances, recentBills, tariffReference] = await Promise.all([
    db.householdAppliance.findMany({
      where: { consumerUnitId },
      include: { catalog: true },
    }),
    db.bill.findMany({
      where: {
        consumerUnitId,
        status: "done",
        consumptionKwh: { not: null },
      },
      orderBy: { referenceMonth: "desc" },
      take: RECENT_BILLS_FOR_WASTE_RULES,
    }),
    db.tariffReference.findFirst({
      where: {
        distributor: consumerUnit.distributor,
        uf: consumerUnit.uf,
        tariffGroup: consumerUnit.tariffGroup,
        tariffSubgroup: consumerUnit.tariffSubgroup,
        validFrom: { lte: new Date() },
        OR: [{ validTo: null }, { validTo: { gte: new Date() } }],
      },
      orderBy: { validFrom: "desc" },
    }),
  ]);

  const kwhRate = tariffReference?.kwhRate ?? null;
  const totalEstimatedKwh = appliances.reduce(
    (sum, appliance) => sum + estimateMonthlyKwh(appliance),
    0,
  );

  const findings = [
    ...applyApplianceEfficiencyRules(appliances, totalEstimatedKwh, kwhRate),
    ...applyWasteRules(recentBills, appliances, totalEstimatedKwh),
    ...applyRankingRule(appliances, totalEstimatedKwh),
  ];

  await db.$transaction([
    db.finding.deleteMany({
      where: {
        consumerUnitId,
        billId: null,
        type: { in: APPLIANCE_DERIVED_TYPES },
      },
    }),
    ...(findings.length > 0
      ? [
          db.finding.createMany({
            data: findings.map((finding) => ({ ...finding, consumerUnitId })),
          }),
        ]
      : []),
  ]);

  return db.finding.findMany({
    where: {
      consumerUnitId,
      billId: null,
      type: { in: APPLIANCE_DERIVED_TYPES },
    },
    orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
  });
}
