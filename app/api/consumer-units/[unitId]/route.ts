import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { consumerUnitSchema } from "@/lib/validations/consumer-unit";

type RouteParams = { params: Promise<{ unitId: string }> };

const notFoundResponse = () =>
  NextResponse.json({ error: "UC não encontrada" }, { status: 404 });

async function findOwnedUnit(unitId: string, userId: string) {
  const unit = await db.consumerUnit.findUnique({ where: { id: unitId } });
  if (!unit || unit.ownerId !== userId) {
    return null;
  }
  return unit;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { unitId } = await params;
  const unit = await findOwnedUnit(unitId, userId);
  if (!unit) {
    return notFoundResponse();
  }

  return NextResponse.json({ unit });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { unitId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = consumerUnitSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    // Ownership is enforced inside the WHERE clause of the mutation itself
    // (not via a separate check-then-act read) to avoid a race where the
    // unit could be deleted or reassigned between the check and the update.
    const { count } = await db.consumerUnit.updateMany({
      where: { id: unitId, ownerId: userId },
      data: parsed.data,
    });
    if (count === 0) {
      return notFoundResponse();
    }
    const unit = await db.consumerUnit.findUnique({ where: { id: unitId } });
    return NextResponse.json({ unit });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Você já tem uma UC cadastrada com este código" },
        { status: 409 },
      );
    }
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { unitId } = await params;
  const { count } = await db.consumerUnit.deleteMany({
    where: { id: unitId, ownerId: userId },
  });
  if (count === 0) {
    return notFoundResponse();
  }

  return new NextResponse(null, { status: 204 });
}
