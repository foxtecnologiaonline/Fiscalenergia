import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApplianceWizard } from "@/components/appliances/appliance-wizard";
import { auth } from "@/lib/auth";
import { estimateMonthlyKwh } from "@/lib/calculations";
import { db } from "@/lib/db";
import { formatReferenceMonth } from "@/lib/validations/bill";

const numberFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
});

export default async function AppliancesPage({
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

  const [catalog, appliances, latestBill] = await Promise.all([
    db.applianceCatalog.findMany({ orderBy: [{ room: "asc" }, { name: "asc" }] }),
    db.householdAppliance.findMany({
      where: { consumerUnitId: unit.id },
      orderBy: { createdAt: "asc" },
    }),
    db.bill.findFirst({
      where: {
        consumerUnitId: unit.id,
        status: "done",
        consumptionKwh: { not: null },
      },
      orderBy: { referenceMonth: "desc" },
    }),
  ]);

  const serializedAppliances = appliances.map((appliance) => ({
    id: appliance.id,
    catalogId: appliance.catalogId,
    name: appliance.name,
    room: appliance.room,
    powerW: appliance.powerW,
    usageHoursPerDay: appliance.usageHoursPerDay,
    usageDaysPerWeek: appliance.usageDaysPerWeek,
    quantity: appliance.quantity,
    ageYears: appliance.ageYears,
    lastMaintenanceAt: appliance.lastMaintenanceAt
      ? appliance.lastMaintenanceAt.toISOString()
      : null,
    condition: appliance.condition,
    isCustom: appliance.isCustom,
  }));

  const totalEstimatedKwh = appliances.reduce(
    (sum, appliance) => sum + estimateMonthlyKwh(appliance),
    0,
  );

  const calibrationPercent =
    latestBill?.consumptionKwh != null && latestBill.consumptionKwh > 0
      ? (totalEstimatedKwh / latestBill.consumptionKwh) * 100
      : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link
          href={`/units/${unit.id}`}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          &larr; {unit.code}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Varredura de aparelhos</h1>
        <p className="text-muted-foreground">
          Percorra os cômodos e informe os aparelhos que você tem. Você pode
          salvar cada cômodo separadamente e continuar depois.
        </p>
      </div>

      <div className="rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">
          Consumo mensal estimado (todos os cômodos)
        </p>
        <p className="text-2xl font-semibold">
          {numberFormatter.format(totalEstimatedKwh)} kWh
        </p>
        {calibrationPercent == null || !latestBill ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Sem fatura para comparar.
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            {numberFormatter.format(calibrationPercent)}% do consumo faturado
            em {formatReferenceMonth(latestBill.referenceMonth)} (
            {numberFormatter.format(latestBill.consumptionKwh ?? 0)} kWh)
          </p>
        )}
      </div>

      <ApplianceWizard
        unitId={unit.id}
        catalog={catalog}
        appliances={serializedAppliances}
      />
    </div>
  );
}
