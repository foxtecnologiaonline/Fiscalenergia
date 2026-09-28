import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ConsumptionRankingChart } from "@/components/appliances/consumption-ranking-chart";
import { auth } from "@/lib/auth";
import { estimateMonthlyKwh } from "@/lib/calculations";
import { db } from "@/lib/db";

const SEVERITY_LABELS = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
} as const;

const FINDING_TYPE_LABELS = {
  appliance_inefficiency: "Eficiência",
  possible_waste_or_loss: "Possível desperdício",
  top_consumer: "Ranking",
} as const;

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export default async function ConsumptionPage({
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

  const [appliances, findings] = await Promise.all([
    db.householdAppliance.findMany({ where: { consumerUnitId: unit.id } }),
    db.finding.findMany({
      where: {
        consumerUnitId: unit.id,
        billId: null,
        type: { in: ["appliance_inefficiency", "possible_waste_or_loss", "top_consumer"] },
      },
      orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
    }),
  ]);

  const rankingEntries = appliances
    .map((appliance) => ({
      name: appliance.name,
      room: appliance.room,
      estimatedKwh: estimateMonthlyKwh(appliance),
    }))
    .filter((entry) => entry.estimatedKwh > 0);

  const efficiencyFindings = findings.filter(
    (finding) => finding.type === "appliance_inefficiency",
  );
  const wasteFindings = findings.filter(
    (finding) => finding.type === "possible_waste_or_loss",
  );
  const rankingFindings = findings.filter(
    (finding) => finding.type === "top_consumer",
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link
          href={`/units/${unit.id}`}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          &larr; {unit.code}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Consumo por aparelho</h1>
        <p className="text-muted-foreground">
          Ranking dos aparelhos que mais consomem e achados de eficiência ou
          possível desperdício, calculados a partir da varredura.
        </p>
      </div>

      {appliances.length === 0 ? (
        <p className="text-muted-foreground">
          Nenhum aparelho cadastrado ainda.{" "}
          <Link
            href={`/units/${unit.id}/appliances`}
            className="underline underline-offset-4"
          >
            Complete a varredura de aparelhos
          </Link>{" "}
          para ver o ranking de consumo.
        </p>
      ) : (
        <div className="rounded-lg border p-4">
          <h2 className="mb-4 text-lg font-semibold">
            Ranking de consumo estimado
          </h2>
          {rankingEntries.length === 0 ? (
            <p className="text-muted-foreground">
              Nenhum aparelho com consumo estimado maior que zero.
            </p>
          ) : (
            <ConsumptionRankingChart entries={rankingEntries} />
          )}
          {rankingFindings.map((finding) => (
            <p key={finding.id} className="mt-4 text-sm text-muted-foreground">
              {finding.description}
            </p>
          ))}
        </div>
      )}

      <div>
        <h2 className="mb-2 text-lg font-semibold">Achados de eficiência</h2>
        {efficiencyFindings.length === 0 ? (
          <p className="text-muted-foreground">
            Nenhum achado de eficiência identificado.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {efficiencyFindings.map((finding) => (
              <li key={finding.id} className="rounded-lg border p-4">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {FINDING_TYPE_LABELS[finding.type as "appliance_inefficiency"]} · Severidade{" "}
                  {SEVERITY_LABELS[finding.severity]}
                </p>
                <p className="mt-1">{finding.description}</p>
                {finding.estimatedImpactAmount != null ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Impacto estimado:{" "}
                    {currencyFormatter.format(finding.estimatedImpactAmount)}
                    /mês
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">
          Indícios de possível desperdício
        </h2>
        <p className="mb-2 text-sm text-muted-foreground">
          Estes alertas são indícios estatísticos, não conclusões — servem
          para orientar uma investigação, nunca são uma acusação.
        </p>
        {wasteFindings.length === 0 ? (
          <p className="text-muted-foreground">Nenhum indício identificado.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {wasteFindings.map((finding) => (
              <li key={finding.id} className="rounded-lg border p-4">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Indício, não conclusão · Severidade{" "}
                  {SEVERITY_LABELS[finding.severity]}
                </p>
                <p className="mt-1">{finding.description}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
