import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const kwhFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
});

export default async function UnitsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const units = await db.consumerUnit.findMany({
    where: { ownerId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  const unitIds = units.map((unit) => unit.id);
  const [billTotals, findingCounts] =
    units.length > 1
      ? await Promise.all([
          db.bill.groupBy({
            by: ["consumerUnitId"],
            where: { consumerUnitId: { in: unitIds }, status: "done" },
            _sum: { consumptionKwh: true, totalAmount: true },
          }),
          db.finding.groupBy({
            by: ["consumerUnitId"],
            where: { consumerUnitId: { in: unitIds } },
            _count: { _all: true },
          }),
        ])
      : [[], []];

  const billTotalsByUnit = new Map(
    billTotals.map((row) => [row.consumerUnitId, row._sum]),
  );
  const findingCountsByUnit = new Map(
    findingCounts.map((row) => [row.consumerUnitId, row._count._all]),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Unidades consumidoras</h1>
        <Button asChild>
          <Link href="/units/new">Nova UC</Link>
        </Button>
      </div>

      {units.length === 0 ? (
        <p className="text-muted-foreground">
          Você ainda não cadastrou nenhuma UC.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Código</th>
                <th className="px-4 py-2 font-medium">Distribuidora</th>
                <th className="px-4 py-2 font-medium">Cidade/UF</th>
                <th className="px-4 py-2 font-medium">Grupo</th>
              </tr>
            </thead>
            <tbody>
              {units.map((unit) => (
                <tr key={unit.id} className="border-t">
                  <td className="px-4 py-2">
                    <Link
                      href={`/units/${unit.id}`}
                      className="font-medium underline underline-offset-4"
                    >
                      {unit.code}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{unit.distributor}</td>
                  <td className="px-4 py-2">
                    {unit.city}/{unit.uf}
                  </td>
                  <td className="px-4 py-2">{unit.tariffGroup}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {units.length > 1 ? (
        <div>
          <h2 className="mb-2 text-lg font-semibold">Comparação entre UCs</h2>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Código</th>
                  <th className="px-4 py-2 font-medium">Consumo total</th>
                  <th className="px-4 py-2 font-medium">Gasto total</th>
                  <th className="px-4 py-2 font-medium">Nº de achados</th>
                </tr>
              </thead>
              <tbody>
                {units.map((unit) => {
                  const sums = billTotalsByUnit.get(unit.id);
                  return (
                    <tr key={unit.id} className="border-t">
                      <td className="px-4 py-2 font-medium">{unit.code}</td>
                      <td className="px-4 py-2">
                        {sums?.consumptionKwh != null
                          ? `${kwhFormatter.format(sums.consumptionKwh)} kWh`
                          : "—"}
                      </td>
                      <td className="px-4 py-2">
                        {sums?.totalAmount != null
                          ? currencyFormatter.format(sums.totalAmount)
                          : "—"}
                      </td>
                      <td className="px-4 py-2">
                        {findingCountsByUnit.get(unit.id) ?? 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
