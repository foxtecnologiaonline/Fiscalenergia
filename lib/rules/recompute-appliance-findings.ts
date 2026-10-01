import type { Finding } from "@prisma/client";

import { db } from "@/lib/db";
import { applyApplianceRules } from "@/lib/rules/apply-appliance-rules";
import { applySuggestions } from "@/lib/rules/apply-suggestions";

/**
 * Recalcula os achados derivados de aparelho (regras 8-13) e regenera as
 * Suggestions a partir deles, com exclusão mútua por UC via advisory lock
 * do Postgres.
 *
 * `applyApplianceRules` substitui inteiro o conjunto de achados derivados
 * de aparelho (delete+recreate) e, logo em seguida, `applySuggestions` lê
 * esse conjunto e faz upsert de Suggestion referenciando `finding.id` por
 * chave estrangeira. Sem exclusão mútua, duas chamadas concorrentes para a
 * mesma UC — por exemplo vários aparelhos de um cômodo salvos em paralelo
 * por um único clique em "Salvar cômodo", ou uma edição de aparelho
 * concorrendo com o fim do processamento de uma fatura — podem se
 * intercalar: o delete+recreate de uma chamada apaga os Findings que a
 * outra acabou de ler, e o upsert desta última falha com violação de
 * chave estrangeira (`Suggestion_findingId_fkey`) ao referenciar um
 * Finding que não existe mais.
 *
 * `pg_advisory_xact_lock(hashtext(consumerUnitId))` serializa esse par de
 * passos por UC — chamadas para UCs diferentes continuam concorrentes — e
 * é liberado automaticamente ao fim da transação que o envolve, mesmo em
 * caso de erro.
 */
export async function recomputeApplianceFindingsAndSuggestions(
  consumerUnitId: string,
): Promise<Finding[]> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${consumerUnitId}))`;

      let findings: Finding[] = [];
      try {
        findings = await applyApplianceRules(consumerUnitId);
      } catch (error) {
        console.error(
          `applyApplianceRules failed for unit ${consumerUnitId}:`,
          error,
        );
      }

      try {
        await applySuggestions(consumerUnitId);
      } catch (error) {
        console.error(
          `applySuggestions failed for unit ${consumerUnitId}:`,
          error,
        );
      }

      return findings;
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}
