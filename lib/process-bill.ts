import type { Bill } from "@prisma/client";

import { extractBillData } from "@/lib/claude";
import { downloadBillFile } from "@/lib/blob";
import { db } from "@/lib/db";
import { applyBillRules } from "@/lib/rules/apply-bill-rules";
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
    try {
      await applyBillRules(billId);
    } catch (error) {
      console.error(`applyBillRules failed for bill ${billId}:`, error);
    }

    return done;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha desconhecida na extração";
    return await db.bill.update({
      where: { id: billId },
      data: { status: "error", errorMessage: message },
    });
  }
}
