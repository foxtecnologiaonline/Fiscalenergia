import type { Finding } from "@prisma/client";

import { db } from "@/lib/db";
import { applyBillingRules } from "@/lib/rules/billing";
import { applyReadingRules } from "@/lib/rules/reading";

/**
 * Runs the billing (5.1) and reading (5.2) rule modules for a processed
 * bill and persists the resulting Findings. Called right after a bill's
 * extraction finishes (see lib/process-bill.ts).
 */
export async function applyBillRules(billId: string): Promise<Finding[]> {
  const bill = await db.bill.findUniqueOrThrow({
    where: { id: billId },
    include: { consumerUnit: true },
  });
  const { consumerUnit } = bill;

  const [tariffFlagRecord, tariffReference, priorBills] = await Promise.all([
    db.tariffFlagHistory.findUnique({
      where: { referenceMonth: bill.referenceMonth },
    }),
    db.tariffReference.findFirst({
      where: {
        distributor: consumerUnit.distributor,
        uf: consumerUnit.uf,
        tariffGroup: consumerUnit.tariffGroup,
        tariffSubgroup: consumerUnit.tariffSubgroup,
        validFrom: { lte: bill.referenceMonth },
        OR: [{ validTo: null }, { validTo: { gte: bill.referenceMonth } }],
      },
      orderBy: { validFrom: "desc" },
    }),
    db.bill.findMany({
      where: {
        consumerUnitId: bill.consumerUnitId,
        status: "done",
        id: { not: bill.id },
        consumptionKwh: { not: null },
      },
      select: { consumptionKwh: true },
    }),
  ]);

  const historicalConsumptions = priorBills
    .map((b) => b.consumptionKwh)
    .filter((value): value is number => value != null);

  const findings = [
    ...applyBillingRules(bill, {
      tariffFlag: tariffFlagRecord?.flag ?? null,
      tariffReference,
    }),
    ...applyReadingRules(bill, historicalConsumptions),
  ];

  if (findings.length === 0) {
    return [];
  }

  await db.finding.createMany({
    data: findings.map((finding) => ({
      ...finding,
      consumerUnitId: bill.consumerUnitId,
      billId: bill.id,
    })),
  });

  return db.finding.findMany({
    where: { billId: bill.id },
    orderBy: { createdAt: "asc" },
  });
}
