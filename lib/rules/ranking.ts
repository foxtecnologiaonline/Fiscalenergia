import type { HouseholdAppliance } from "@prisma/client";

import { estimateMonthlyKwh } from "@/lib/calculations";
import type { FindingInput } from "@/lib/rules/types";

const TOP_N = 3;

/**
 * Regra 13 — ranking dos aparelhos por % do consumo total estimado, sempre
 * gerando um achado destacando o top 1-3 (quando há pelo menos um aparelho
 * com consumo estimado maior que zero).
 */
export function applyRankingRule(
  appliances: HouseholdAppliance[],
  totalEstimatedKwh: number,
): FindingInput[] {
  if (totalEstimatedKwh <= 0) return [];

  const ranked = appliances
    .map((appliance) => ({ appliance, estimated: estimateMonthlyKwh(appliance) }))
    .filter((entry) => entry.estimated > 0)
    .sort((a, b) => b.estimated - a.estimated)
    .slice(0, TOP_N);

  if (ranked.length === 0) return [];

  const summary = ranked
    .map(
      (entry) =>
        `${entry.appliance.name} (${entry.appliance.room}, ${Math.round(
          (entry.estimated / totalEstimatedKwh) * 100,
        )}%)`,
    )
    .join(", ");

  return [
    {
      type: "top_consumer",
      ruleCode: "ranking.top_consumers",
      severity: "low",
      description: `Os aparelhos que mais consomem nesta UC são: ${summary}.`,
      estimatedImpactAmount: null,
    },
  ];
}
