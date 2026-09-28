import type { Bill, HouseholdAppliance } from "@prisma/client";

import type { FindingInput } from "@/lib/rules/types";

// Regra 11: fração do consumo faturado não explicada pela soma estimada
// dos aparelhos, acima da qual o gap é considerado relevante.
const UNIDENTIFIED_GAP_RATIO = 0.3;
// Regra 12: aumento de consumo entre os dois últimos meses acima do qual
// é considerado um salto.
const CONSUMPTION_JUMP_RATIO = 0.4;

type RecentBill = Pick<Bill, "referenceMonth" | "consumptionKwh">;

function monthsBetween(earlier: Date, later: Date): number {
  return (
    (later.getUTCFullYear() - earlier.getUTCFullYear()) * 12 +
    (later.getUTCMonth() - earlier.getUTCMonth())
  );
}

/**
 * Regra 11 — a soma estimada dos aparelhos fica muito abaixo do consumo
 * faturado, de forma persistente por 2+ meses seguidos. `recentBills` deve
 * vir ordenado do mês mais recente para o mais antigo. Um único mês de gap
 * não gera achado (evita falso positivo de uma fatura atípica isolada).
 *
 * `totalEstimatedKwh` é o retrato *atual* dos aparelhos cadastrados (a
 * varredura não é versionada por mês) — por isso a regra só reforça o
 * sinal quando o gap se repete contra vários meses reais, não quando
 * compara mês a mês uma varredura que também mudou.
 */
export function checkPersistentUnidentifiedConsumption(
  recentBills: RecentBill[],
  totalEstimatedKwh: number,
): FindingInput[] {
  if (recentBills.length < 2) return [];

  const [latest, previous] = recentBills;
  if (latest.consumptionKwh == null || previous.consumptionKwh == null) {
    return [];
  }
  if (monthsBetween(previous.referenceMonth, latest.referenceMonth) !== 1) {
    return [];
  }

  const gaps = [latest, previous].map(
    (bill) =>
      (bill.consumptionKwh! - totalEstimatedKwh) / bill.consumptionKwh!,
  );
  if (gaps.some((gap) => gap < UNIDENTIFIED_GAP_RATIO)) return [];

  const averageGapPercent = Math.round(
    ((gaps[0] + gaps[1]) / 2) * 100,
  );

  return [
    {
      type: "possible_waste_or_loss",
      ruleCode: "waste.unidentified_consumption_persistent",
      severity: "medium",
      description: `Nos últimos dois meses, cerca de ${averageGapPercent}% do consumo faturado não é explicado pelos aparelhos cadastrados (soma estimada: ${totalEstimatedKwh.toFixed(1)} kWh/mês) — isso é um indício estatístico, não uma conclusão. Verifique a instalação elétrica ou revise a varredura de aparelhos.`,
      estimatedImpactAmount: null,
    },
  ];
}

/**
 * Regra 12 — salto de consumo entre os dois últimos meses sem um novo
 * aparelho cadastrado no período que explique o aumento. A variação
 * sazonal esperada (ex.: verão/ar-condicionado) e mudanças de hábito de
 * uso de um aparelho já existente não são modeladas neste MVP — limitação
 * conhecida (ver docs/SCOPE.md, seção 5.4), o que mantém a regra mais
 * conservadora (limiar alto) para reduzir falsos positivos.
 */
export function checkUnexplainedConsumptionJump(
  recentBills: RecentBill[],
  appliances: Pick<HouseholdAppliance, "createdAt">[],
): FindingInput[] {
  if (recentBills.length < 2) return [];

  const [latest, previous] = recentBills;
  if (
    latest.consumptionKwh == null ||
    previous.consumptionKwh == null ||
    previous.consumptionKwh <= 0
  ) {
    return [];
  }

  const jump =
    (latest.consumptionKwh - previous.consumptionKwh) / previous.consumptionKwh;
  if (jump <= CONSUMPTION_JUMP_RATIO) return [];

  const hasNewAppliance = appliances.some(
    (appliance) =>
      appliance.createdAt > previous.referenceMonth &&
      appliance.createdAt <= latest.referenceMonth,
  );
  if (hasNewAppliance) return [];

  return [
    {
      type: "possible_waste_or_loss",
      ruleCode: "waste.unexplained_consumption_jump",
      severity: "high",
      description: `O consumo faturado subiu ${Math.round(jump * 100)}% em relação ao mês anterior, sem nenhum aparelho novo cadastrado nesse período — isso é um indício estatístico, não uma conclusão. Recomendamos inspeção da instalação elétrica e conferência com a distribuidora.`,
      estimatedImpactAmount: null,
    },
  ];
}

export function applyWasteRules(
  recentBills: RecentBill[],
  appliances: Pick<HouseholdAppliance, "createdAt">[],
  totalEstimatedKwh: number,
): FindingInput[] {
  return [
    ...checkPersistentUnidentifiedConsumption(recentBills, totalEstimatedKwh),
    ...checkUnexplainedConsumptionJump(recentBills, appliances),
  ];
}
