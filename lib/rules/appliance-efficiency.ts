import type { ApplianceCatalog, ApplianceCondition, HouseholdAppliance } from "@prisma/client";

import { estimateMonthlyKwh } from "@/lib/calculations";
import type { FindingInput } from "@/lib/rules/types";

// Regra 8: acima de 30% da referência ajustada já é sinalizado; acima de
// 60% sobe a severidade.
const ABOVE_REFERENCE_RATIO = 1.3;
const ABOVE_REFERENCE_HIGH_RATIO = 1.6;
// Regra 9: só prioriza manutenção/substituição quando o aparelho responde
// por uma fatia relevante do consumo total estimado da casa.
const OUTDATED_CONTRIBUTION_SHARE = 0.15;
// Regra 10: uso declarado 50%+ acima do padrão típico do catálogo.
const ABOVE_TYPICAL_USAGE_RATIO = 1.5;
const ABOVE_TYPICAL_USAGE_HIGH_RATIO = 2;

// Idade e condição alteram o quanto de consumo "acima da referência" é
// esperado antes de soar como ineficiência (regra 8) — um aparelho antigo
// ou sem manutenção naturalmente consome um pouco mais que a referência do
// catálogo (que assume um aparelho em condição média).
const CONDITION_TOLERANCE: Record<ApplianceCondition, number> = {
  novo: 1,
  normal: 1,
  antigo: 1.15,
  sem_manutencao: 1.25,
};

function ageTolerance(ageYears: number | null): number {
  if (ageYears == null || ageYears <= 5) return 1;
  return 1 + Math.min((ageYears - 5) * 0.02, 0.3);
}

export type ApplianceWithCatalog = HouseholdAppliance & {
  catalog: ApplianceCatalog | null;
};

/**
 * Regra 8 — consumo estimado do aparelho muito acima da referência do
 * catálogo para a mesma categoria, ajustada por idade/condição. Sem
 * catalogId ou sem referenceKwhMonth no item de catálogo, não avalia
 * (nunca gera falso positivo por falta de referência).
 */
export function checkAboveReferenceConsumption(
  appliance: ApplianceWithCatalog,
  kwhRate: number | null,
): FindingInput[] {
  if (appliance.catalog?.referenceKwhMonth == null) return [];

  const adjustedReference =
    appliance.catalog.referenceKwhMonth *
    CONDITION_TOLERANCE[appliance.condition] *
    ageTolerance(appliance.ageYears);
  if (adjustedReference <= 0) return [];

  const estimated = estimateMonthlyKwh(appliance);
  const ratio = estimated / adjustedReference;
  if (ratio <= ABOVE_REFERENCE_RATIO) return [];

  const extraKwh = estimated - adjustedReference;

  return [
    {
      type: "appliance_inefficiency",
      ruleCode: "appliance.above_reference_consumption",
      severity: ratio > ABOVE_REFERENCE_HIGH_RATIO ? "high" : "medium",
      description: `${appliance.name} (${appliance.room}): consumo estimado de ${estimated.toFixed(1)} kWh/mês está ${((ratio - 1) * 100).toFixed(0)}% acima do esperado para esse tipo de aparelho (referência ajustada: ${adjustedReference.toFixed(1)} kWh/mês) — considere verificar o estado do aparelho.`,
      estimatedImpactAmount: kwhRate != null ? extraKwh * kwhRate : null,
    },
  ];
}

/**
 * Regra 9 — aparelho declarado antigo ou sem manutenção que também
 * representa uma parcela relevante do consumo total estimado da casa,
 * priorizando a sugestão de manutenção/substituição.
 */
export function checkOutdatedOrUnmaintained(
  appliance: ApplianceWithCatalog,
  totalEstimatedKwh: number,
): FindingInput[] {
  if (
    appliance.condition !== "antigo" &&
    appliance.condition !== "sem_manutencao"
  ) {
    return [];
  }
  if (totalEstimatedKwh <= 0) return [];

  const estimated = estimateMonthlyKwh(appliance);
  const share = estimated / totalEstimatedKwh;
  if (share < OUTDATED_CONTRIBUTION_SHARE) return [];

  const conditionLabel =
    appliance.condition === "antigo" ? "antigo" : "sem manutenção registrada";

  return [
    {
      type: "appliance_inefficiency",
      ruleCode: "appliance.outdated_or_unmaintained",
      severity: "medium",
      description: `${appliance.name} (${appliance.room}): aparelho ${conditionLabel} que representa ${(share * 100).toFixed(0)}% do consumo estimado da casa — priorize manutenção ou substituição.`,
      estimatedImpactAmount: null,
    },
  ];
}

/**
 * Regra 10 — uso declarado (horas/dia) muito acima do padrão típico do
 * catálogo para esse tipo de aparelho.
 */
export function checkAboveTypicalUsage(
  appliance: ApplianceWithCatalog,
  kwhRate: number | null,
): FindingInput[] {
  if (!appliance.catalog || appliance.catalog.typicalUsageHoursPerDay <= 0) {
    return [];
  }

  const ratio =
    appliance.usageHoursPerDay / appliance.catalog.typicalUsageHoursPerDay;
  if (ratio <= ABOVE_TYPICAL_USAGE_RATIO) return [];

  const estimated = estimateMonthlyKwh(appliance);
  const typicalKwh = estimateMonthlyKwh({
    powerW: appliance.powerW,
    usageHoursPerDay: appliance.catalog.typicalUsageHoursPerDay,
    usageDaysPerWeek: appliance.usageDaysPerWeek,
    quantity: appliance.quantity,
  });
  const extraKwh = estimated - typicalKwh;

  return [
    {
      type: "appliance_inefficiency",
      ruleCode: "appliance.above_typical_usage",
      severity: ratio > ABOVE_TYPICAL_USAGE_HIGH_RATIO ? "high" : "medium",
      description: `${appliance.name} (${appliance.room}): uso declarado de ${appliance.usageHoursPerDay}h/dia está bem acima do padrão típico (${appliance.catalog.typicalUsageHoursPerDay}h/dia) — isso pode explicar parte do consumo elevado.`,
      estimatedImpactAmount: kwhRate != null ? extraKwh * kwhRate : null,
    },
  ];
}

export function applyApplianceEfficiencyRules(
  appliances: ApplianceWithCatalog[],
  totalEstimatedKwh: number,
  kwhRate: number | null,
): FindingInput[] {
  return appliances.flatMap((appliance) => [
    ...checkAboveReferenceConsumption(appliance, kwhRate),
    ...checkOutdatedOrUnmaintained(appliance, totalEstimatedKwh),
    ...checkAboveTypicalUsage(appliance, kwhRate),
  ]);
}
