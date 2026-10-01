import type { Bill, Finding, Suggestion } from "@prisma/client";

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { buildSuggestion } from "@/lib/rules/suggestions";
import { formatReferenceMonth } from "@/lib/validations/bill";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function getUnitOwner(consumerUnitId: string) {
  const unit = await db.consumerUnit.findUniqueOrThrow({
    where: { id: consumerUnitId },
    select: {
      code: true,
      owner: {
        select: { id: true, email: true, emailNotificationsEnabled: true },
      },
    },
  });
  return unit;
}

/**
 * Envia o e-mail (best-effort, nunca lança) e registra a Notification,
 * respeitando o opt-out do usuário (User.emailNotificationsEnabled) —
 * quando desativado, não envia nem registra nada.
 */
async function notify(params: {
  userId: string;
  userEmail: string;
  emailNotificationsEnabled: boolean;
  billId: string | null;
  subject: string;
  message: string;
}): Promise<void> {
  if (!params.emailNotificationsEnabled) return;

  await sendEmail({
    to: params.userEmail,
    subject: params.subject,
    html: `<p>${escapeHtml(params.message)}</p>`,
  });

  await db.notification.create({
    data: {
      userId: params.userId,
      billId: params.billId,
      channel: "email",
      message: params.message,
    },
  });
}

/** (a) Notifica quando o processamento de uma fatura termina (sucesso ou erro). */
export async function notifyBillProcessed(bill: Bill): Promise<void> {
  const unit = await getUnitOwner(bill.consumerUnitId);
  const monthLabel = formatReferenceMonth(bill.referenceMonth);

  const message =
    bill.status === "done"
      ? `A fatura de ${monthLabel} da UC ${unit.code} foi processada com sucesso.`
      : `Não foi possível processar a fatura de ${monthLabel} da UC ${unit.code}: ${bill.errorMessage ?? "erro desconhecido"}.`;

  await notify({
    userId: unit.owner.id,
    userEmail: unit.owner.email,
    emailNotificationsEnabled: unit.owner.emailNotificationsEnabled,
    billId: bill.id,
    subject: `Fiscalenergia: fatura de ${monthLabel} (${unit.code}) processada`,
    message,
  });
}

/**
 * (b) Notifica quando um achado de severidade alta é gerado.
 *
 * Achados de fatura/leitura (billId != null) são fatos novos a cada
 * fatura por construção (nunca recalculados), então sempre notificam.
 * Achados derivados de aparelho (billId nulo) são recriados do zero a
 * cada execução de applyApplianceRules (Fase 6), mesmo quando o problema
 * já era conhecido — sem filtro, o mesmo aparelho antigo não corrigido
 * geraria um e-mail todo mês, para sempre. `sinceDate` (capturado antes
 * desta passagem de processamento começar) permite distinguir "achado
 * novo" de "achado recorrente": a Suggestion correspondente (upsertada
 * por lib/rules/apply-suggestions.ts, que nunca atualiza createdAt em um
 * upsert) só tem `createdAt >= sinceDate` se foi criada agora.
 */
export async function notifyHighSeverityFindings(
  findings: Finding[],
  bill: Bill,
  sinceDate: Date,
): Promise<void> {
  const highFindings = findings.filter((finding) => finding.severity === "high");
  if (highFindings.length === 0) return;

  const newHighFindings: Finding[] = [];
  for (const finding of highFindings) {
    if (finding.billId != null) {
      newHighFindings.push(finding);
      continue;
    }

    const input = buildSuggestion(finding);
    if (!input) {
      // Achado de severidade alta sem ação mapeada (não deveria ocorrer
      // na prática — ver ACTION_TITLES — mas por segurança notifica em
      // vez de silenciar um achado real).
      newHighFindings.push(finding);
      continue;
    }

    const suggestion = await db.suggestion.findUnique({
      where: {
        consumerUnitId_ruleCode_title: {
          consumerUnitId: finding.consumerUnitId,
          ruleCode: input.ruleCode,
          title: input.title,
        },
      },
      select: { createdAt: true },
    });
    if (!suggestion || suggestion.createdAt >= sinceDate) {
      newHighFindings.push(finding);
    }
  }
  if (newHighFindings.length === 0) return;

  const unit = await getUnitOwner(bill.consumerUnitId);
  const monthLabel = formatReferenceMonth(bill.referenceMonth);
  const message = `Identificamos ${newHighFindings.length} achado(s) de severidade alta na UC ${unit.code} (referente à fatura de ${monthLabel}): ${newHighFindings.map((f) => f.description).join(" ")}`;

  await notify({
    userId: unit.owner.id,
    userEmail: unit.owner.email,
    emailNotificationsEnabled: unit.owner.emailNotificationsEnabled,
    billId: bill.id,
    subject: `Fiscalenergia: achado de severidade alta na UC ${unit.code}`,
    message,
  });
}

/** (c) Notifica quando sugestões aplicadas tiveram sua avaliação concluída. */
export async function notifySuggestionsEvaluated(
  suggestions: Suggestion[],
  bill: Bill,
): Promise<void> {
  if (suggestions.length === 0) return;

  const unit = await getUnitOwner(bill.consumerUnitId);
  const monthLabel = formatReferenceMonth(bill.referenceMonth);
  const message = `${suggestions.length} sugestão(ões) aplicada(s) na UC ${unit.code} foram avaliadas com a fatura de ${monthLabel}: ${suggestions.map((s) => s.title).join(", ")}.`;

  await notify({
    userId: unit.owner.id,
    userEmail: unit.owner.email,
    emailNotificationsEnabled: unit.owner.emailNotificationsEnabled,
    billId: bill.id,
    subject: `Fiscalenergia: economia avaliada na UC ${unit.code}`,
    message,
  });
}
