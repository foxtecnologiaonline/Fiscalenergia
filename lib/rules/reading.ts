import type { Bill } from "@prisma/client";

import type { FindingInput } from "@/lib/rules/types";

const READING_DIVERGENCE_TOLERANCE_KWH = 1;
const TYPICAL_BILLING_DAYS_MIN = 28;
const TYPICAL_BILLING_DAYS_MAX = 32;
const CONSUMPTION_ANOMALY_THRESHOLD = 0.5; // 50% de variação sobre a média

/** Regra 5 — leitura atual menos anterior não bate com o consumo faturado. */
export function checkReadingDivergence(bill: Bill): FindingInput[] {
  const { previousReadingKwh, currentReadingKwh, consumptionKwh } = bill;
  if (
    previousReadingKwh == null ||
    currentReadingKwh == null ||
    consumptionKwh == null
  ) {
    return [];
  }

  const computedConsumption = currentReadingKwh - previousReadingKwh;
  const diff = computedConsumption - consumptionKwh;
  if (Math.abs(diff) <= READING_DIVERGENCE_TOLERANCE_KWH) return [];

  return [
    {
      type: "reading_error",
      ruleCode: "reading.reading_divergence",
      severity: Math.abs(diff) > consumptionKwh * 0.2 ? "high" : "medium",
      description: `A diferença entre a leitura atual e a anterior (${computedConsumption} kWh) não bate com o consumo faturado (${consumptionKwh} kWh) — possível erro de leitura, leitura estimada pela distribuidora, ou constante de medição incorreta.`,
      estimatedImpactAmount:
        bill.appliedKwhRate != null
          ? Math.abs(diff) * bill.appliedKwhRate
          : null,
    },
  ];
}

/** Regra 6 — período de faturamento fora do padrão usual (28-32 dias). */
export function checkAtypicalBillingPeriod(bill: Bill): FindingInput[] {
  if (bill.billingDays == null) return [];
  if (
    bill.billingDays >= TYPICAL_BILLING_DAYS_MIN &&
    bill.billingDays <= TYPICAL_BILLING_DAYS_MAX
  ) {
    return [];
  }

  return [
    {
      type: "reading_error",
      ruleCode: "reading.atypical_billing_period",
      severity: "low",
      description: `O período de faturamento (${bill.billingDays} dias) está fora do padrão usual (${TYPICAL_BILLING_DAYS_MIN}-${TYPICAL_BILLING_DAYS_MAX} dias) — comparações com outros meses podem exigir ajuste proporcional.`,
      estimatedImpactAmount: null,
    },
  ];
}

/**
 * Regra 7 — consumo do mês foge do padrão histórico da UC. Exige pelo
 * menos uma fatura anterior concluída com consumo identificado; sem
 * histórico, não avalia (nunca gera erro com uma única fatura).
 */
export function checkConsumptionAnomaly(
  bill: Bill,
  historicalConsumptions: number[],
): FindingInput[] {
  if (bill.consumptionKwh == null || historicalConsumptions.length === 0) {
    return [];
  }

  const average =
    historicalConsumptions.reduce((sum, value) => sum + value, 0) /
    historicalConsumptions.length;
  if (average === 0) return [];

  const deviation = (bill.consumptionKwh - average) / average;
  if (Math.abs(deviation) <= CONSUMPTION_ANOMALY_THRESHOLD) return [];

  const impact =
    bill.appliedKwhRate != null
      ? Math.abs(bill.consumptionKwh - average) * bill.appliedKwhRate
      : null;

  return [
    {
      type: "consumption_anomaly",
      ruleCode: "reading.consumption_anomaly",
      severity: Math.abs(deviation) > 1 ? "high" : "medium",
      description: `O consumo faturado (${bill.consumptionKwh} kWh) está ${(Math.abs(deviation) * 100).toFixed(0)}% ${deviation > 0 ? "acima" : "abaixo"} da média histórica desta UC (${average.toFixed(0)} kWh).`,
      estimatedImpactAmount: impact,
    },
  ];
}

export function applyReadingRules(
  bill: Bill,
  historicalConsumptions: number[],
): FindingInput[] {
  return [
    ...checkReadingDivergence(bill),
    ...checkAtypicalBillingPeriod(bill),
    ...checkConsumptionAnomaly(bill, historicalConsumptions),
  ];
}
