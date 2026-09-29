import type { Bill, Finding, Suggestion } from "@prisma/client";

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { formatReferenceMonth } from "@/lib/validations/bill";

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
    html: `<p>${params.message}</p>`,
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

/** (b) Notifica quando um achado de severidade alta é gerado. */
export async function notifyHighSeverityFindings(
  findings: Finding[],
  bill: Bill,
): Promise<void> {
  const highFindings = findings.filter((finding) => finding.severity === "high");
  if (highFindings.length === 0) return;

  const unit = await getUnitOwner(bill.consumerUnitId);
  const monthLabel = formatReferenceMonth(bill.referenceMonth);
  const message = `Identificamos ${highFindings.length} achado(s) de severidade alta na UC ${unit.code} (referente à fatura de ${monthLabel}): ${highFindings.map((f) => f.description).join(" ")}`;

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
