import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { processBill } from "@/lib/process-bill";
import { requireUserId } from "@/lib/session";

type RouteParams = { params: Promise<{ billId: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { billId } = await params;
  const bill = await db.bill.findUnique({
    where: { id: billId },
    include: { consumerUnit: true },
  });

  if (!bill || bill.consumerUnit.ownerId !== userId) {
    return NextResponse.json({ error: "Fatura não encontrada" }, { status: 404 });
  }

  const updated = await processBill(billId);
  if (!updated) {
    return NextResponse.json(
      {
        error: "Esta fatura já foi processada ou já está em processamento",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ bill: updated });
}
