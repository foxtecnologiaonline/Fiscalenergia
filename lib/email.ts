import { Resend } from "resend";

const FROM_ADDRESS =
  process.env.RESEND_FROM_EMAIL ?? "Fiscalenergia <notificacoes@fiscalenergia.app>";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

/**
 * Envia um e-mail transacional via Resend. Sem `RESEND_API_KEY`
 * configurada (dev/test), registra o conteúdo no log em vez de enviar —
 * o critério de aceite da Fase 9 permite validar "em ambiente de teste do
 * Resend ou com log/mock" (ver docs/IMPLEMENTATION_PLAN.md). Nunca lança:
 * o chamador decide se o envio falhar deve impedir o registro em
 * Notification (best-effort, mesmo padrão do restante do motor de regras).
 */
export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<void> {
  if (!resend) {
    console.log(`[email:dev] to=${to} subject="${subject}"\n${html}`);
    return;
  }

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html,
    });
    if (error) {
      console.error(`Falha ao enviar e-mail via Resend para ${to}:`, error);
    }
  } catch (error) {
    console.error(`Falha ao enviar e-mail via Resend para ${to}:`, error);
  }
}
