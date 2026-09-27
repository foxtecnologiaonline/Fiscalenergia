import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BillUploadForm } from "@/components/bills/bill-upload-form";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatReferenceMonth } from "@/lib/validations/bill";

const STATUS_LABELS = {
  pending: "Pendente",
  processing: "Processando",
  done: "Concluída",
  error: "Erro",
} as const;

export default async function ConsumerUnitBillsPage({
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

  const bills = await db.bill.findMany({
    where: { consumerUnitId: unit.id },
    orderBy: { referenceMonth: "desc" },
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <div>
        <Link
          href={`/units/${unit.id}`}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          &larr; {unit.code}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Faturas</h1>
      </div>

      <BillUploadForm consumerUnitId={unit.id} />

      {bills.length === 0 ? (
        <p className="text-muted-foreground">
          Nenhuma fatura enviada para esta UC ainda.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Mês de referência</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((bill) => (
                <tr key={bill.id} className="border-t">
                  <td className="px-4 py-2">
                    <Link
                      href={`/units/${unit.id}/bills/${bill.id}`}
                      className="font-medium underline underline-offset-4"
                    >
                      {formatReferenceMonth(bill.referenceMonth)}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{STATUS_LABELS[bill.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
