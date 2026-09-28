import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApplySuggestionForm } from "@/components/suggestions/apply-suggestion-form";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatReferenceMonth } from "@/lib/validations/bill";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const numberFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
});

function formatAmount(value: number | null) {
  return value == null ? "não estimado" : currencyFormatter.format(value);
}

function formatKwh(value: number | null) {
  return value == null ? "não estimado" : `${numberFormatter.format(value)} kWh`;
}

function byEstimatedSavingsDesc<T extends { estimatedSavingsAmount: number | null }>(
  items: T[],
): T[] {
  return [...items].sort(
    (a, b) => (b.estimatedSavingsAmount ?? -Infinity) - (a.estimatedSavingsAmount ?? -Infinity),
  );
}

export default async function SuggestionsPage({
  params,
}: {
  params: Promise<{ unitId: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { unitId } = await params;
  const unit = await db.consumerUnit.findUnique({ where: { id: unitId } });
  if (!unit || unit.ownerId !== session.user.id) {
    notFound();
  }

  const suggestions = await db.suggestion.findMany({
    where: { consumerUnitId: unit.id, status: { not: "dismissed" } },
    include: { baselineBill: true, followUpBill: true },
  });

  const pending = byEstimatedSavingsDesc(
    suggestions.filter((s) => s.status === "suggested"),
  );
  const inTracking = byEstimatedSavingsDesc(
    suggestions.filter((s) => s.status === "applied" && !s.evaluatedAt),
  );
  const evaluated = byEstimatedSavingsDesc(
    suggestions.filter((s) => s.status === "applied" && s.evaluatedAt),
  );

  function combinedEffectCount(
    suggestion: (typeof suggestions)[number],
  ): number {
    return suggestions.filter(
      (other) =>
        other.id !== suggestion.id &&
        other.evaluatedAt &&
        other.baselineBillId === suggestion.baselineBillId &&
        other.followUpBillId === suggestion.followUpBillId,
    ).length;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <div>
        <Link
          href={`/units/${unit.id}`}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          &larr; {unit.code}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Sugestões de economia</h1>
        <p className="text-muted-foreground">
          Geradas a partir dos achados de fatura, leitura e aparelhos,
          ordenadas pelo impacto financeiro estimado.
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Pendentes</h2>
        {pending.length === 0 ? (
          <p className="text-muted-foreground">Nenhuma sugestão pendente.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((suggestion) => (
              <li key={suggestion.id} className="rounded-lg border p-4">
                <p className="font-medium">{suggestion.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {suggestion.description}
                </p>
                <p className="mt-2 text-sm">
                  Economia estimada: {formatAmount(suggestion.estimatedSavingsAmount)}
                  {suggestion.estimatedSavingsKwh != null
                    ? ` (${formatKwh(suggestion.estimatedSavingsKwh)})`
                    : ""}
                  /mês
                </p>
                <div className="mt-3">
                  <ApplySuggestionForm suggestionId={suggestion.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Em acompanhamento</h2>
        {inTracking.length === 0 ? (
          <p className="text-muted-foreground">
            Nenhuma sugestão aplicada aguardando a próxima fatura.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {inTracking.map((suggestion) => (
              <li key={suggestion.id} className="rounded-lg border p-4">
                <p className="font-medium">{suggestion.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Aplicada: {suggestion.appliedNote}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Economia estimada: {formatAmount(suggestion.estimatedSavingsAmount)}
                  /mês. Assim que a próxima fatura desta UC for processada,
                  mostramos a economia real obtida.
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Avaliadas</h2>
        {evaluated.length === 0 ? (
          <p className="text-muted-foreground">
            Nenhuma sugestão avaliada ainda.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {evaluated.map((suggestion) => {
              const combinedWith = combinedEffectCount(suggestion);
              return (
                <li key={suggestion.id} className="rounded-lg border p-4">
                  <p className="font-medium">{suggestion.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Aplicada: {suggestion.appliedNote}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-muted-foreground">Economia estimada</p>
                      <p className="font-medium">
                        {formatAmount(suggestion.estimatedSavingsAmount)}/mês
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Economia real</p>
                      <p className="font-medium">
                        {formatAmount(suggestion.actualSavingsAmount)}
                        {suggestion.actualSavingsKwh != null
                          ? ` (${formatKwh(suggestion.actualSavingsKwh)})`
                          : ""}
                      </p>
                    </div>
                  </div>
                  {suggestion.baselineBill && suggestion.followUpBill ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Comparação entre {formatReferenceMonth(suggestion.baselineBill.referenceMonth)} e{" "}
                      {formatReferenceMonth(suggestion.followUpBill.referenceMonth)}.
                    </p>
                  ) : null}
                  {combinedWith > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground italic">
                      Efeito combinado com outra{combinedWith > 1 ? "s" : ""}{" "}
                      {combinedWith} sugestão{combinedWith > 1 ? "ões" : ""}{" "}
                      aplicada{combinedWith > 1 ? "s" : ""} no mesmo período —
                      não é possível atribuir isoladamente quanto veio de cada
                      ação.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
