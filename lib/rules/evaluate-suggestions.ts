import type { Bill, Suggestion } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * Avalia as Suggestions "em acompanhamento" (status = applied, ainda sem
 * followUpBillId) de uma UC contra a fatura que acabou de ser processada:
 * define followUpBillId, calcula actualSavingsKwh/actualSavingsAmount
 * (baseline − follow-up) e marca evaluatedAt.
 *
 * Limitação conhecida (ver docs/SCOPE.md, seção 5.6): se mais de uma
 * sugestão foi aplicada entre a mesma dupla baseline/follow-up, a economia
 * real aqui calculada é a mesma para todas elas — o app não consegue
 * atribuir isoladamente quanto veio de cada ação; a UI deve deixar claro
 * que é o efeito combinado quando isso ocorrer.
 */
export async function evaluateAppliedSuggestions(
  consumerUnitId: string,
  followUpBill: Bill,
): Promise<Suggestion[]> {
  const pending = await db.suggestion.findMany({
    where: {
      consumerUnitId,
      status: "applied",
      followUpBillId: null,
      baselineBillId: { not: null },
      NOT: { baselineBillId: followUpBill.id },
    },
    include: { baselineBill: true },
  });

  const updated: Suggestion[] = [];
  for (const suggestion of pending) {
    const baselineBill = suggestion.baselineBill;
    if (!baselineBill) continue;

    // Faturas podem ser enviadas fora de ordem (ex.: uma fatura antiga que
    // faltava é processada depois de uma mais recente já ter servido de
    // baseline). Só avalia contra uma fatura que realmente veio DEPOIS do
    // baseline — do contrário a "economia" calculada não faz sentido e
    // ficaria travada para sempre (evaluatedAt uma vez definido não é
    // reavaliado).
    if (followUpBill.referenceMonth <= baselineBill.referenceMonth) continue;

    const actualSavingsKwh =
      baselineBill.consumptionKwh != null && followUpBill.consumptionKwh != null
        ? baselineBill.consumptionKwh - followUpBill.consumptionKwh
        : null;
    const actualSavingsAmount =
      baselineBill.totalAmount != null && followUpBill.totalAmount != null
        ? baselineBill.totalAmount - followUpBill.totalAmount
        : null;

    updated.push(
      await db.suggestion.update({
        where: { id: suggestion.id },
        data: {
          followUpBillId: followUpBill.id,
          actualSavingsKwh,
          actualSavingsAmount,
          evaluatedAt: new Date(),
        },
      }),
    );
  }

  return updated;
}
