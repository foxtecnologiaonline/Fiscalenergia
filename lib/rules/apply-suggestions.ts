import type { Suggestion } from "@prisma/client";

import { db } from "@/lib/db";
import { buildSuggestion } from "@/lib/rules/suggestions";

/**
 * Gera/atualiza as Suggestions de uma UC a partir de todos os seus
 * Findings atuais (fatura, leitura, eficiência de aparelho e desperdício —
 * ver docs/SCOPE.md, seção 5.6). Upsert por (consumerUnitId, ruleCode,
 * title): uma sugestão já existente tem sua descrição/estimativa
 * atualizadas, mas nunca seu status/appliedAt/tracking — aplicar ou
 * descartar uma sugestão não pode ser desfeito só porque a mesma regra
 * disparou de novo no próximo ciclo de fatura.
 */
export async function applySuggestions(
  consumerUnitId: string,
): Promise<Suggestion[]> {
  const findings = await db.finding.findMany({ where: { consumerUnitId } });

  for (const finding of findings) {
    const input = buildSuggestion(finding);
    if (!input) continue;

    let householdApplianceId: string | null = null;
    if (input.applianceSubject) {
      const appliance = await db.householdAppliance.findFirst({
        where: {
          consumerUnitId,
          name: input.applianceSubject.name,
          room: input.applianceSubject.room,
        },
      });
      householdApplianceId = appliance?.id ?? null;
    }

    await db.suggestion.upsert({
      where: {
        consumerUnitId_ruleCode_title: {
          consumerUnitId,
          ruleCode: input.ruleCode,
          title: input.title,
        },
      },
      update: {
        description: input.description,
        estimatedSavingsKwh: input.estimatedSavingsKwh,
        estimatedSavingsAmount: input.estimatedSavingsAmount,
        findingId: finding.id,
        householdApplianceId,
      },
      create: {
        consumerUnitId,
        findingId: finding.id,
        householdApplianceId,
        ruleCode: input.ruleCode,
        title: input.title,
        description: input.description,
        estimatedSavingsKwh: input.estimatedSavingsKwh,
        estimatedSavingsAmount: input.estimatedSavingsAmount,
      },
    });
  }

  return db.suggestion.findMany({ where: { consumerUnitId } });
}
