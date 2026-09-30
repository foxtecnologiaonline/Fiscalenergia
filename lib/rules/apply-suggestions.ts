import type { Suggestion } from "@prisma/client";

import { db } from "@/lib/db";
import { buildSuggestion } from "@/lib/rules/suggestions";

function applianceKey(name: string, room: string): string {
  return `${name}\u0000${room}`;
}

/**
 * Gera/atualiza as Suggestions de uma UC a partir de todos os seus
 * Findings atuais (fatura, leitura, eficiência de aparelho e desperdício —
 * ver docs/SCOPE.md, seção 5.6). Upsert por (consumerUnitId, ruleCode,
 * title): uma sugestão já existente tem sua descrição/estimativa
 * atualizadas, mas nunca seu status/appliedAt/tracking — aplicar ou
 * descartar uma sugestão não pode ser desfeito só porque a mesma regra
 * disparou de novo no próximo ciclo de fatura.
 *
 * Sugestões "suggested" (nunca aplicadas) cujo par (ruleCode, title) não
 * aparece mais no conjunto atual de achados são removidas ao final — o
 * problema que as gerou não existe mais (aparelho corrigido/removido,
 * fatura corrigida), então não há histórico a preservar e mantê-las
 * listadas como pendentes para sempre seria enganoso. Uma sugestão já
 * "applied" nunca é tocada aqui, mesmo que o achado de origem tenha
 * sumido (é por isso que Suggestion.findingId usa onDelete: SetNull).
 */
export async function applySuggestions(
  consumerUnitId: string,
): Promise<Suggestion[]> {
  const [findings, appliances] = await Promise.all([
    db.finding.findMany({ where: { consumerUnitId } }),
    db.householdAppliance.findMany({
      where: { consumerUnitId },
      select: { id: true, name: true, room: true },
    }),
  ]);

  const applianceIdByKey = new Map(
    appliances.map((appliance) => [
      applianceKey(appliance.name, appliance.room),
      appliance.id,
    ]),
  );

  const currentKeys = new Set<string>();

  for (const finding of findings) {
    const input = buildSuggestion(finding);
    if (!input) continue;

    currentKeys.add(`${input.ruleCode}\u0000${input.title}`);

    const householdApplianceId = input.applianceSubject
      ? (applianceIdByKey.get(
          applianceKey(input.applianceSubject.name, input.applianceSubject.room),
        ) ?? null)
      : null;

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

  const staleSuggested = await db.suggestion.findMany({
    where: { consumerUnitId, status: "suggested" },
    select: { id: true, ruleCode: true, title: true },
  });
  const staleIds = staleSuggested
    .filter((s) => !currentKeys.has(`${s.ruleCode}\u0000${s.title}`))
    .map((s) => s.id);
  if (staleIds.length > 0) {
    await db.suggestion.deleteMany({ where: { id: { in: staleIds } } });
  }

  return db.suggestion.findMany({ where: { consumerUnitId } });
}
