import type { FindingSeverity } from "@prisma/client";

import { formatReferenceMonth } from "@/lib/validations/bill";

export type MonthlyDataPoint = {
  month: string;
  consumptionKwh: number | null;
  totalAmount: number | null;
};

/**
 * Ordena as faturas por mês de referência e formata o rótulo do mês
 * (MM/AAAA) para os gráficos de histórico. Espera receber apenas faturas
 * já processadas (`status: "done"`) — a filtragem é responsabilidade de
 * quem chama, este helper só ordena/formata.
 */
export function buildMonthlySeries(
  bills: {
    referenceMonth: Date;
    consumptionKwh: number | null;
    totalAmount: number | null;
  }[],
): MonthlyDataPoint[] {
  return [...bills]
    .sort((a, b) => a.referenceMonth.getTime() - b.referenceMonth.getTime())
    .map((bill) => ({
      month: formatReferenceMonth(bill.referenceMonth),
      consumptionKwh: bill.consumptionKwh,
      totalAmount: bill.totalAmount,
    }));
}

export type FindingSeverityCounts = Record<FindingSeverity, number>;

const EMPTY_SEVERITY_COUNTS: FindingSeverityCounts = { low: 0, medium: 0, high: 0 };

/** Conta achados por severidade, sempre retornando as três chaves (0 quando não há achados daquela severidade). */
export function summarizeFindingsBySeverity(
  findings: { severity: FindingSeverity }[],
): FindingSeverityCounts {
  const counts = { ...EMPTY_SEVERITY_COUNTS };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}
