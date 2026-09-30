import { Prisma, type Finding, type FindingType } from "@prisma/client";

import { estimateMonthlyKwh } from "@/lib/calculations";
import { db } from "@/lib/db";
import { applyApplianceEfficiencyRules } from "@/lib/rules/appliance-efficiency";
import { applyRankingRule } from "@/lib/rules/ranking";
import { applyWasteRules } from "@/lib/rules/waste";

const RECENT_BILLS_FOR_WASTE_RULES = 2;
const MAX_SERIALIZATION_RETRIES = 3;

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
 *
 * Leitura + cálculo + substituição rodam em uma única transação
 * `Serializable`: duas chamadas concorrentes para a mesma UC (ex.: duas
 * abas editando aparelhos diferentes ao mesmo tempo) nunca produzem um
 * conjunto de achados calculado a partir de uma leitura parcialmente
 * desatualizada — o Postgres aborta uma das transações com erro de
 * serialização, e o retry abaixo a repete do zero contra o estado já
 * commitado.
 */
export async function applyApplianceRules(
  consumerUnitId: string,
): Promise<Finding[]> {
  for (let attempt = 1; attempt <= MAX_SERIALIZATION_RETRIES; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          const consumerUnit = await tx.consumerUnit.findUniqueOrThrow({
            where: { id: consumerUnitId },
          });

          const [appliances, recentBills, tariffReference] = await Promise.all([
            tx.householdAppliance.findMany({
              where: { consumerUnitId },
              include: { catalog: true },
            }),
            tx.bill.findMany({
              where: {
                consumerUnitId,
                status: "done",
                consumptionKwh: { not: null },
              },
              orderBy: { referenceMonth: "desc" },
              take: RECENT_BILLS_FOR_WASTE_RULES,
            }),
            tx.tariffReference.findFirst({
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

          await tx.finding.deleteMany({
            where: {
              consumerUnitId,
              billId: null,
              type: { in: APPLIANCE_DERIVED_TYPES },
            },
          });
          if (findings.length > 0) {
            await tx.finding.createMany({
              data: findings.map((finding) => ({ ...finding, consumerUnitId })),
            });
          }

          return tx.finding.findMany({
            where: {
              consumerUnitId,
              billId: null,
              type: { in: APPLIANCE_DERIVED_TYPES },
            },
            orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const isSerializationFailure =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";
      if (!isSerializationFailure || attempt === MAX_SERIALIZATION_RETRIES) {
        throw error;
      }
    }
  }

  // Inalcançável (o loop sempre retorna ou lança na última tentativa) —
  // só para satisfazer o checador de tipos.
  throw new Error("applyApplianceRules: retries exhausted unexpectedly");
}
