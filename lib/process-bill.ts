import type { Bill } from "@prisma/client";

import { extractBillData } from "@/lib/claude";
import { downloadBillFile } from "@/lib/blob";
import { db } from "@/lib/db";
import {
  notifyBillProcessed,
  notifyHighSeverityFindings,
  notifySuggestionsEvaluated,
} from "@/lib/notifications";
import { applyBillRules } from "@/lib/rules/apply-bill-rules";
import { evaluateAppliedSuggestions } from "@/lib/rules/evaluate-suggestions";
import { recomputeApplianceFindingsAndSuggestions } from "@/lib/rules/recompute-appliance-findings";
import { isAcceptedBillFileType } from "@/lib/validations/bill";

/**
 * Downloads the bill's file, extracts its data via Claude, and saves the
 * result. Returns the updated Bill, or `null` when the bill wasn't in
 * `pending` status (already processed or currently being processed by
 * another call) — the pending -> processing transition is atomic, so
 * concurrent calls for the same bill can only ever have one of them proceed.
 */
export async function processBill(billId: string): Promise<Bill | null> {
  const { count } = await db.bill.updateMany({
    where: { id: billId, status: "pending" },
    data: { status: "processing" },
  });
  if (count === 0) {
    return null;
  }

  const bill = await db.bill.findUniqueOrThrow({ where: { id: billId } });

  try {
    const { buffer, contentType } = await downloadBillFile(bill.fileUrl);
    if (!isAcceptedBillFileType(contentType)) {
      throw new Error(
        `Tipo de arquivo não suportado para extração: ${contentType}`,
      );
    }

    const extracted = await extractBillData(buffer, contentType);

    const done = await db.bill.update({
      where: { id: billId },
      data: {
        status: "done",
        totalAmount: extracted.totalAmount,
        consumptionKwh: extracted.consumptionKwh,
        tariffFlag: extracted.tariffFlag,
        previousReadingKwh: extracted.previousReadingKwh,
        currentReadingKwh: extracted.currentReadingKwh,
        billingDays: extracted.billingDays,
        appliedKwhRate: extracted.appliedKwhRate,
        lineItems: extracted.lineItems,
        extractedData: extracted,
        errorMessage: null,
      },
    });

    // Best-effort: the extraction itself already succeeded, so a bug in the
    // rules engine shouldn't retroactively mark a readable bill as "error".
    let billFindings: Awaited<ReturnType<typeof applyBillRules>> = [];
    try {
      billFindings = await applyBillRules(billId);
    } catch (error) {
      console.error(`applyBillRules failed for bill ${billId}:`, error);
    }

    // Também recalcula os achados derivados de aparelhos (regras 8-13) e
    // regenera as Suggestions a partir deles: um consumo faturado novo
    // pode mudar o gap de consumo não identificado (regra 11) e o salto
    // sem causa aparente (regra 12). As duas etapas rodam com exclusão
    // mútua por UC (lib/rules/recompute-appliance-findings.ts) para nunca
    // se intercalar com uma edição de aparelho concorrente — sem isso, o
    // delete+recreate de achados de uma chamada pode apagar o Finding que
    // a outra acabou de referenciar em um upsert de Suggestion, violando a
    // chave estrangeira. `suggestionsSinceDate` é capturado antes para
    // permitir distinguir achado de aparelho novo de recorrente na
    // notificação (b) logo abaixo.
    const suggestionsSinceDate = new Date();
    let applianceFindings: Awaited<
      ReturnType<typeof recomputeApplianceFindingsAndSuggestions>
    > = [];
    try {
      applianceFindings = await recomputeApplianceFindingsAndSuggestions(
        done.consumerUnitId,
      );
    } catch (error) {
      console.error(
        `recomputeApplianceFindingsAndSuggestions failed for bill ${billId}:`,
        error,
      );
    }

    let evaluatedSuggestions: Awaited<ReturnType<typeof evaluateAppliedSuggestions>> = [];
    try {
      evaluatedSuggestions = await evaluateAppliedSuggestions(done.consumerUnitId, done);
    } catch (error) {
      console.error(`evaluateAppliedSuggestions failed for bill ${billId}:`, error);
    }

    // Notificações por e-mail (Fase 9, docs/SCOPE.md seção 6, passo 10):
    // (a) processamento concluído, (b) achado de severidade alta,
    // (c) sugestão aplicada avaliada — cada uma best-effort e independente
    // das outras (uma falha em uma não deve impedir as demais de rodar).
    try {
      await notifyBillProcessed(done);
    } catch (error) {
      console.error(`notifyBillProcessed failed for bill ${billId}:`, error);
    }
    try {
      await notifyHighSeverityFindings(
        [...billFindings, ...applianceFindings],
        done,
        suggestionsSinceDate,
      );
    } catch (error) {
      console.error(`notifyHighSeverityFindings failed for bill ${billId}:`, error);
    }
    try {
      await notifySuggestionsEvaluated(evaluatedSuggestions, done);
    } catch (error) {
      console.error(`notifySuggestionsEvaluated failed for bill ${billId}:`, error);
    }

    return done;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha desconhecida na extração";
    const failed = await db.bill.update({
      where: { id: billId },
      data: { status: "error", errorMessage: message },
    });

    try {
      await notifyBillProcessed(failed);
    } catch (notifyError) {
      console.error(`notifyBillProcessed failed for bill ${billId}:`, notifyError);
    }

    return failed;
  }
}
