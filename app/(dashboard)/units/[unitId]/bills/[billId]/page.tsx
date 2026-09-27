import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatReferenceMonth } from "@/lib/validations/bill";
import { lineItemSchema } from "@/lib/validations/extracted-bill";

const STATUS_LABELS = {
  pending: "Pendente",
  processing: "Processando",
  done: "Concluída",
  error: "Erro",
} as const;

const TARIFF_FLAG_LABELS = {
  verde: "Verde",
  amarela: "Amarela",
  vermelha_p1: "Vermelha - Patamar 1",
  vermelha_p2: "Vermelha - Patamar 2",
} as const;

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const numberFormatter = new Intl.NumberFormat("pt-BR");
const NOT_IDENTIFIED = "Não identificado";

function formatCurrency(value: number | null) {
  return value == null ? NOT_IDENTIFIED : currencyFormatter.format(value);
}

function formatNumber(value: number | null, suffix = "") {
  return value == null
    ? NOT_IDENTIFIED
    : `${numberFormatter.format(value)}${suffix}`;
}

export default async function BillDetailPage({
  params,
}: {
  params: Promise<{ unitId: string; billId: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { unitId, billId } = await params;
  const bill = await db.bill.findUnique({
    where: { id: billId },
    include: { consumerUnit: true },
  });

  if (
    !bill ||
    bill.consumerUnitId !== unitId ||
    bill.consumerUnit.ownerId !== session.user.id
  ) {
    notFound();
  }

  const parsedLineItems = z.array(lineItemSchema).safeParse(bill.lineItems);
  const lineItems = parsedLineItems.success ? parsedLineItems.data : [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link
          href={`/units/${unitId}/bills`}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          &larr; Faturas
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          Fatura de {formatReferenceMonth(bill.referenceMonth)}
        </h1>
        <p className="text-muted-foreground">
          Status: {STATUS_LABELS[bill.status]}
        </p>
      </div>

      {bill.status === "error" ? (
        <p className="text-sm text-destructive" role="alert">
          {bill.errorMessage ?? "Não foi possível processar esta fatura."}
        </p>
      ) : null}

      {bill.status === "pending" || bill.status === "processing" ? (
        <p className="text-muted-foreground">
          Esta fatura ainda está sendo processada. Atualize a página em
          alguns instantes.
        </p>
      ) : null}

      {bill.status === "done" ? (
        <>
          <div className="grid grid-cols-2 gap-4 rounded-lg border p-4 text-sm">
            <div>
              <p className="text-muted-foreground">Valor total</p>
              <p className="font-medium">{formatCurrency(bill.totalAmount)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Consumo faturado</p>
              <p className="font-medium">
                {formatNumber(bill.consumptionKwh, " kWh")}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Bandeira tarifária</p>
              <p className="font-medium">
                {bill.tariffFlag
                  ? TARIFF_FLAG_LABELS[bill.tariffFlag]
                  : NOT_IDENTIFIED}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">
                Tarifa aplicada (R$/kWh)
              </p>
              <p className="font-medium">
                {bill.appliedKwhRate == null
                  ? NOT_IDENTIFIED
                  : bill.appliedKwhRate.toFixed(4)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Leitura anterior</p>
              <p className="font-medium">
                {formatNumber(bill.previousReadingKwh, " kWh")}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Leitura atual</p>
              <p className="font-medium">
                {formatNumber(bill.currentReadingKwh, " kWh")}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Dias de faturamento</p>
              <p className="font-medium">
                {bill.billingDays == null ? NOT_IDENTIFIED : bill.billingDays}
              </p>
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-lg font-semibold">Itens da fatura</h2>
            {lineItems.length === 0 ? (
              <p className="text-muted-foreground">
                Nenhum item detalhado identificado.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-4 py-2 font-medium">Descrição</th>
                      <th className="px-4 py-2 font-medium">Quantidade</th>
                      <th className="px-4 py-2 font-medium">
                        Tarifa unitária
                      </th>
                      <th className="px-4 py-2 font-medium">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item, index) => (
                      <tr key={index} className="border-t">
                        <td className="px-4 py-2">{item.description}</td>
                        <td className="px-4 py-2">
                          {formatNumber(item.quantity)}
                        </td>
                        <td className="px-4 py-2">
                          {formatCurrency(item.unitRate)}
                        </td>
                        <td className="px-4 py-2">
                          {formatCurrency(item.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
