import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ConsumptionRankingChart } from "@/components/appliances/consumption-ranking-chart";
import { MonthlyBarChart } from "@/components/dashboard/monthly-bar-chart";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { estimateMonthlyKwh } from "@/lib/calculations";
import { buildMonthlySeries, summarizeFindingsBySeverity } from "@/lib/dashboard";
import { db } from "@/lib/db";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const SEVERITY_LABELS = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
} as const;

const RANKING_LIMIT = 5;
const OPEN_SUGGESTIONS_LIMIT = 3;

export default async function ConsumerUnitDashboardPage({
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

  const [doneBills, appliances, findings, openSuggestions] = await Promise.all([
    db.bill.findMany({
      where: { consumerUnitId: unit.id, status: "done" },
      select: { referenceMonth: true, consumptionKwh: true, totalAmount: true },
    }),
    db.householdAppliance.findMany({ where: { consumerUnitId: unit.id } }),
    db.finding.findMany({
      where: { consumerUnitId: unit.id },
      select: { severity: true },
    }),
    db.suggestion.findMany({
      where: { consumerUnitId: unit.id, status: "suggested" },
    }),
  ]);

  const monthlySeries = buildMonthlySeries(doneBills);
  const severityCounts = summarizeFindingsBySeverity(findings);

  const rankingEntries = appliances
    .map((appliance) => ({
      name: appliance.name,
      room: appliance.room,
      estimatedKwh: estimateMonthlyKwh(appliance),
    }))
    .filter((entry) => entry.estimatedKwh > 0)
    .sort((a, b) => b.estimatedKwh - a.estimatedKwh)
    .slice(0, RANKING_LIMIT);

  const topOpenSuggestions = [...openSuggestions]
    .sort(
      (a, b) =>
        (b.estimatedSavingsAmount ?? -Infinity) -
        (a.estimatedSavingsAmount ?? -Infinity),
    )
    .slice(0, OPEN_SUGGESTIONS_LIMIT);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div>
        <Link
          href="/units"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          &larr; Minhas UCs
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{unit.code}</h1>
            <p className="text-muted-foreground">
              {unit.distributor} · {unit.city}/{unit.uf}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={`/units/${unit.id}/edit`}>Editar</Link>
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/units/${unit.id}/bills`}>Ver faturas</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/units/${unit.id}/appliances`}>
              Varredura de aparelhos
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/units/${unit.id}/consumption`}>
              Consumo por aparelho
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/units/${unit.id}/suggestions`}>
              Sugestões de economia
            </Link>
          </Button>
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-lg font-semibold">
          Histórico de consumo e gasto
        </h2>
        {monthlySeries.length === 0 ? (
          <p className="text-muted-foreground">
            Nenhuma fatura processada ainda.{" "}
            <Link
              href={`/units/${unit.id}/bills`}
              className="underline underline-offset-4"
            >
              Envie a primeira fatura
            </Link>{" "}
            para ver a evolução de consumo e gasto.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-sm text-muted-foreground">
                Consumo mensal (kWh)
              </p>
              <MonthlyBarChart
                data={monthlySeries}
                valueKey="consumptionKwh"
                color="var(--chart-kwh)"
                seriesLabel="Consumo"
                valueType="kwh"
              />
            </div>
            <div>
              <p className="mb-2 text-sm text-muted-foreground">
                Gasto mensal (R$)
              </p>
              <MonthlyBarChart
                data={monthlySeries}
                valueKey="totalAmount"
                color="var(--chart-spend)"
                seriesLabel="Gasto"
                valueType="currency"
              />
            </div>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-4 text-lg font-semibold">
          Aparelhos que mais consomem
        </h2>
        {rankingEntries.length === 0 ? (
          <p className="text-muted-foreground">
            Nenhum aparelho com consumo estimado ainda.{" "}
            <Link
              href={`/units/${unit.id}/appliances`}
              className="underline underline-offset-4"
            >
              Complete a varredura de aparelhos
            </Link>
            .
          </p>
        ) : (
          <ConsumptionRankingChart entries={rankingEntries} />
        )}
      </div>

      <div>
        <h2 className="mb-4 text-lg font-semibold">Achados</h2>
        {findings.length === 0 ? (
          <p className="text-muted-foreground">
            Nenhum achado identificado ainda.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4">
              {(["high", "medium", "low"] as const).map((severity) => (
                <div key={severity} className="rounded-lg border p-4 text-center">
                  <p className="text-2xl font-semibold">
                    {severityCounts[severity]}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Severidade {SEVERITY_LABELS[severity]}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Veja os detalhes nas{" "}
              <Link
                href={`/units/${unit.id}/bills`}
                className="underline underline-offset-4"
              >
                faturas
              </Link>{" "}
              e no{" "}
              <Link
                href={`/units/${unit.id}/consumption`}
                className="underline underline-offset-4"
              >
                consumo por aparelho
              </Link>
              .
            </p>
          </>
        )}
      </div>

      <div>
        <h2 className="mb-4 text-lg font-semibold">Sugestões em aberto</h2>
        {topOpenSuggestions.length === 0 ? (
          <p className="text-muted-foreground">
            Nenhuma sugestão pendente no momento.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {topOpenSuggestions.map((suggestion) => (
                <li key={suggestion.id} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">{suggestion.title}</p>
                  {suggestion.estimatedSavingsAmount != null ? (
                    <p className="text-muted-foreground">
                      Economia estimada:{" "}
                      {currencyFormatter.format(suggestion.estimatedSavingsAmount)}
                      /mês
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-muted-foreground">
              {openSuggestions.length}{" "}
              {openSuggestions.length === 1
                ? "sugestão pendente"
                : "sugestões pendentes"}{" "}
              no total. Veja todas em{" "}
              <Link
                href={`/units/${unit.id}/suggestions`}
                className="underline underline-offset-4"
              >
                sugestões de economia
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </div>
  );
}
