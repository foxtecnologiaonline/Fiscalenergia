import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { householdApplianceSchema } from "@/lib/validations/appliance";

type RouteParams = { params: Promise<{ unitId: string }> };

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
    return NextResponse.json({ error: "UC não encontrada" }, { status: 404 });
  }

  const appliances = await db.householdAppliance.findMany({
    where: { consumerUnitId: unitId },
    orderBy: [{ room: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({ appliances });
}

export async function POST(request: Request, { params }: RouteParams) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { unitId } = await params;
  const unit = await findOwnedUnit(unitId, userId);
  if (!unit) {
    return NextResponse.json({ error: "UC não encontrada" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = householdApplianceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  if (parsed.data.catalogId) {
    const catalogItem = await db.applianceCatalog.findUnique({
      where: { id: parsed.data.catalogId },
    });
    if (!catalogItem) {
      return NextResponse.json(
        { error: "Item de catálogo não encontrado" },
        { status: 400 },
      );
    }
  }

  const appliance = await db.householdAppliance.create({
    data: { ...parsed.data, consumerUnitId: unitId },
  });

  return NextResponse.json({ appliance }, { status: 201 });
}
