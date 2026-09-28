import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { ROOMS } from "@/lib/validations/appliance";

/**
 * Lista o catálogo de referência de aparelhos, usado para pré-preencher o
 * assistente de varredura. Requer autenticação (não expõe dados sensíveis,
 * mas evita uso não autenticado da API).
 */
export async function GET(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const room = searchParams.get("room");
  if (room && !(ROOMS as readonly string[]).includes(room)) {
    return NextResponse.json({ error: "Cômodo inválido" }, { status: 400 });
  }

  const catalog = await db.applianceCatalog.findMany({
    where: room ? { room: room as (typeof ROOMS)[number] } : undefined,
    orderBy: [{ room: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({ catalog });
}
