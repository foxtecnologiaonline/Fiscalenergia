import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { applySuggestionSchema } from "@/lib/validations/suggestion";

type RouteParams = { params: Promise<{ suggestionId: string }> };

/**
 * Marca uma sugestão como aplicada: salva a nota livre do usuário e define
 * baselineBillId como a fatura mais recente `done` daquela UC (ver
 * docs/SCOPE.md, seção 5.6). A avaliação (economia real vs estimada)
 * acontece depois, quando a próxima fatura da UC é processada — ver
 * lib/rules/evaluate-suggestions.ts.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { suggestionId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = applySuggestionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const suggestion = await db.suggestion.findUnique({
    where: { id: suggestionId },
    include: { consumerUnit: true },
  });
  if (!suggestion || suggestion.consumerUnit.ownerId !== userId) {
    return NextResponse.json(
      { error: "Sugestão não encontrada" },
      { status: 404 },
    );
  }
  if (suggestion.status !== "suggested") {
    return NextResponse.json(
      { error: "Esta sugestão já foi aplicada ou descartada" },
      { status: 409 },
    );
  }

  const latestDoneBill = await db.bill.findFirst({
    where: { consumerUnitId: suggestion.consumerUnitId, status: "done" },
    orderBy: { referenceMonth: "desc" },
  });

  // O guard `status: "suggested"` no WHERE fecha a corrida entre a
  // checagem acima e esta escrita: uma segunda chamada concorrente só
  // consegue aplicar a sugestão uma vez.
  const { count } = await db.suggestion.updateMany({
    where: { id: suggestionId, status: "suggested" },
    data: {
      status: "applied",
      appliedAt: new Date(),
      appliedNote: parsed.data.appliedNote,
      baselineBillId: latestDoneBill?.id ?? null,
    },
  });
  if (count === 0) {
    return NextResponse.json(
      { error: "Esta sugestão já foi aplicada ou descartada" },
      { status: 409 },
    );
  }

  const updated = await db.suggestion.findUnique({
    where: { id: suggestionId },
  });
  return NextResponse.json({ suggestion: updated });
}
