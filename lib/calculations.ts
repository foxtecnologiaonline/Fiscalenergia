// Aproximação fixa de dias por mês usada pelo assistente de varredura (ver
// docs/SCOPE.md, seção "Cálculo de consumo estimado por aparelho") — não
// varia por mês real, já que a estimativa é apenas uma referência para
// calibração, não um valor faturado.
const DAYS_PER_MONTH = 30;
const DAYS_PER_WEEK = 7;

export type ApplianceConsumptionInput = {
  powerW: number;
  usageHoursPerDay: number;
  usageDaysPerWeek: number;
  quantity: number;
};

/**
 * consumoMensalEstimadoKwh =
 *   (powerW * usageHoursPerDay * (usageDaysPerWeek / 7) * diasNoMes) / 1000
 *   * quantity
 */
export function estimateMonthlyKwh({
  powerW,
  usageHoursPerDay,
  usageDaysPerWeek,
  quantity,
}: ApplianceConsumptionInput): number {
  return (
    ((powerW * usageHoursPerDay * (usageDaysPerWeek / DAYS_PER_WEEK) * DAYS_PER_MONTH) /
      1000) *
    quantity
  );
}
