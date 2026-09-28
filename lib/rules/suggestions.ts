import type { Finding } from "@prisma/client";

export type SuggestionInput = {
  ruleCode: string;
  title: string;
  description: string;
  estimatedSavingsKwh: number | null;
  estimatedSavingsAmount: number | null;
  applianceSubject: { name: string; room: string } | null;
};

// Título de ação por regra (5.6, docs/SCOPE.md) — "ranking.top_consumers"
// não aparece aqui de propósito: é um achado informativo (regra 13), não
// uma ação concreta a sugerir.
const ACTION_TITLES: Record<string, string> = {
  "billing.tariff_flag_mismatch": "Contestar bandeira tarifária cobrada incorretamente",
  "billing.kwh_rate_mismatch": "Contestar tarifa de kWh cobrada incorretamente",
  "billing.icms_rate_mismatch": "Contestar alíquota de ICMS cobrada incorretamente",
  "billing.line_item_math_error": "Contestar item da fatura com erro de cálculo",
  "reading.reading_divergence": "Solicitar revisão da leitura do medidor",
  "reading.atypical_billing_period": "Verificar o período de faturamento atípico",
  "reading.consumption_anomaly": "Investigar a anomalia de consumo do mês",
  "appliance.above_reference_consumption": "Verificar aparelho com consumo acima do esperado",
  "appliance.outdated_or_unmaintained": "Agendar manutenção ou considerar substituição do aparelho",
  "appliance.above_typical_usage": "Revisar o tempo de uso do aparelho",
  "waste.unidentified_consumption_persistent": "Investigar consumo não identificado pelos aparelhos cadastrados",
  "waste.unexplained_consumption_jump": "Investigar aumento de consumo sem causa aparente",
};

// Achados de aparelho (lib/rules/appliance-efficiency.ts) sempre começam a
// descrição com "Nome (Cômodo): ..." — usado só para dar um título
// específico por aparelho, já que dois aparelhos podem disparar a mesma
// regra e precisam gerar sugestões distintas (não uma sobrescrevendo a
// outra).
const APPLIANCE_SUBJECT_PATTERN = /^(.+?) \(([^)]+)\):/;

/**
 * Converte um Finding relevante (5.1 a 5.5) em uma sugestão de ação, com
 * estimativa de economia quando o achado já carrega um impacto calculado.
 * Retorna null quando o achado não tem uma ação associada (0 de "0..n").
 */
export function buildSuggestion(finding: Finding): SuggestionInput | null {
  const title = ACTION_TITLES[finding.ruleCode];
  if (!title) return null;

  const subjectMatch = finding.description.match(APPLIANCE_SUBJECT_PATTERN);
  const applianceSubject = subjectMatch
    ? { name: subjectMatch[1], room: subjectMatch[2] }
    : null;

  return {
    ruleCode: finding.ruleCode,
    title: applianceSubject
      ? `${title} — ${applianceSubject.name} (${applianceSubject.room})`
      : title,
    description: finding.description,
    estimatedSavingsKwh: null,
    estimatedSavingsAmount: finding.estimatedImpactAmount,
    applianceSubject,
  };
}
