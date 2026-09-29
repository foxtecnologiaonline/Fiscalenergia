import type { Bill } from "@prisma/client";

import { extractBillData } from "@/lib/claude";
import { downloadBillFile } from "@/lib/blob";
import { db } from "@/lib/db";
import {
  notifyBillProcessed,
  notifyHighSeverityFindings,
  notifySuggestionsEvaluated,
} from "@/lib/notifications";
import { applyApplianceRules } from "@/lib/rules/apply-appliance-rules";
import { applyBillRules } from "@/lib/rules/apply-bill-rules";
import { applySuggestions } from "@/lib/rules/apply-suggestions";
import { evaluateAppliedSuggestions } from "@/lib/rules/evaluate-suggestions";
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

    // Também recalcula os achados derivados de aparelhos (regras 8-13):
    // um consumo faturado novo pode mudar o gap de consumo não
    // identificado (regra 11) e o salto sem causa aparente (regra 12).
    let applianceFindings: Awaited<ReturnType<typeof applyApplianceRules>> = [];
    try {
      applianceFindings = await applyApplianceRules(done.consumerUnitId);
    } catch (error) {
      console.error(`applyApplianceRules failed for bill ${billId}:`, error);
    }

    // Gera/atualiza as Suggestions a partir dos Findings recém-calculados
    // acima, e avalia qualquer sugestão "em acompanhamento" (status
    // applied, sem followUpBillId) contra esta fatura (5.6).
    let evaluatedSuggestions: Awaited<ReturnType<typeof evaluateAppliedSuggestions>> = [];
    try {
      await applySuggestions(done.consumerUnitId);
      evaluatedSuggestions = await evaluateAppliedSuggestions(done.consumerUnitId, done);
    } catch (error) {
      console.error(`applySuggestions/evaluateAppliedSuggestions failed for bill ${billId}:`, error);
    }

    // Notificações por e-mail (Fase 9, docs/SCOPE.md seção 6, passo 10):
    // (a) processamento concluído, (b) achado de severidade alta,
    // (c) sugestão aplicada avaliada — sempre best-effort.
    try {
      await notifyBillProcessed(done);
      await notifyHighSeverityFindings(
        [...billFindings, ...applianceFindings],
        done,
      );
      await notifySuggestionsEvaluated(evaluatedSuggestions, done);
    } catch (error) {
      console.error(`notifications failed for bill ${billId}:`, error);
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
