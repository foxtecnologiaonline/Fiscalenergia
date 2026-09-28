import type { Bill, TariffFlag, TariffReference } from "@prisma/client";

import { formatReferenceMonth } from "@/lib/validations/bill";
import { parseLineItems } from "@/lib/validations/extracted-bill";
import type { FindingInput } from "@/lib/rules/types";

const KWH_RATE_TOLERANCE = 0.005; // R$/kWh
const ICMS_RATE_TOLERANCE = 0.005; // fração (0,5 ponto percentual)
const LINE_ITEM_AMOUNT_TOLERANCE = 0.02; // R$, folga de arredondamento

function severityByImpact(impact: number): "low" | "medium" | "high" {
  const abs = Math.abs(impact);
  if (abs < 10) return "low";
  if (abs < 50) return "medium";
  return "high";
}

/** Regra 1 — bandeira cobrada diverge da bandeira vigente no mês. */
export function checkTariffFlag(
  bill: Bill,
  expectedFlag: TariffFlag | null,
): FindingInput[] {
  if (!bill.tariffFlag || !expectedFlag || bill.tariffFlag === expectedFlag) {
    return [];
  }

  return [
    {
      type: "billing_error",
      ruleCode: "billing.tariff_flag_mismatch",
      severity: "medium",
      description: `A fatura cobrou a bandeira "${bill.tariffFlag}", mas a bandeira vigente em ${formatReferenceMonth(bill.referenceMonth)} era "${expectedFlag}".`,
      estimatedImpactAmount: null,
    },
  ];
}

/** Regra 2 — tarifa de kWh aplicada diverge da tarifa homologada. */
export function checkKwhRate(
  bill: Bill,
  reference: TariffReference | null,
): FindingInput[] {
  if (bill.appliedKwhRate == null || !reference) return [];

  const diff = bill.appliedKwhRate - reference.kwhRate;
  if (Math.abs(diff) <= KWH_RATE_TOLERANCE) return [];

  const impact = bill.consumptionKwh != null ? diff * bill.consumptionKwh : null;

  return [
    {
      type: "billing_error",
      ruleCode: "billing.kwh_rate_mismatch",
      severity: impact != null ? severityByImpact(impact) : "medium",
      description: `A tarifa de kWh cobrada (R$ ${bill.appliedKwhRate.toFixed(4)}) diverge da tarifa homologada para esta UC (R$ ${reference.kwhRate.toFixed(4)}).`,
      estimatedImpactAmount: impact,
    },
  ];
}

function isIcmsLineItem(description: string): boolean {
  return /icms/i.test(description);
}

/**
 * Regra 3 — taxas/encargos fora do esperado. Só o ICMS é verificado: é o
 * único encargo com uma referência no modelo de dados (TariffReference.
 * icmsRate); COSIP/iluminação pública variam por município e não têm
 * tabela de referência própria neste MVP (ver docs/SCOPE.md, seção 10).
 */
export function checkIcmsRate(
  bill: Bill,
  reference: TariffReference | null,
): FindingInput[] {
  if (!reference) return [];

  const findings: FindingInput[] = [];
  for (const item of parseLineItems(bill.lineItems)) {
    if (!isIcmsLineItem(item.description) || item.unitRate == null) continue;

    const diff = item.unitRate - reference.icmsRate;
    if (Math.abs(diff) <= ICMS_RATE_TOLERANCE) continue;

    const impact = item.quantity != null ? diff * item.quantity : null;

    findings.push({
      type: "billing_error",
      ruleCode: "billing.icms_rate_mismatch",
      severity: impact != null ? severityByImpact(impact) : "low",
      description: `A alíquota de ICMS aplicada (${(item.unitRate * 100).toFixed(2)}%) diverge da alíquota esperada para ${reference.uf} (${(reference.icmsRate * 100).toFixed(2)}%).`,
      estimatedImpactAmount: impact,
    });
  }
  return findings;
}

/** Regra 4 — quantidade × tarifa unitária não bate com o valor cobrado. */
export function checkLineItemMath(bill: Bill): FindingInput[] {
  const findings: FindingInput[] = [];

  for (const item of parseLineItems(bill.lineItems)) {
    if (item.quantity == null || item.unitRate == null || item.amount == null) {
      continue;
    }

    const expected = item.quantity * item.unitRate;
    const diff = item.amount - expected;
    if (Math.abs(diff) <= LINE_ITEM_AMOUNT_TOLERANCE) continue;

    findings.push({
      type: "billing_error",
      ruleCode: "billing.line_item_math_error",
      severity: severityByImpact(diff),
      description: `O item "${item.description}" não fecha a conta: ${item.quantity} × R$ ${item.unitRate.toFixed(4)} deveria ser R$ ${expected.toFixed(2)}, mas a fatura cobrou R$ ${item.amount.toFixed(2)}.`,
      estimatedImpactAmount: diff,
    });
  }
  return findings;
}

export function applyBillingRules(
  bill: Bill,
  context: {
    tariffFlag: TariffFlag | null;
    tariffReference: TariffReference | null;
  },
): FindingInput[] {
  return [
    ...checkTariffFlag(bill, context.tariffFlag),
    ...checkKwhRate(bill, context.tariffReference),
    ...checkIcmsRate(bill, context.tariffReference),
    ...checkLineItemMath(bill),
  ];
}
