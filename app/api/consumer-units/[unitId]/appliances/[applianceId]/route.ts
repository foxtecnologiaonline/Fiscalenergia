import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { applyApplianceRules } from "@/lib/rules/apply-appliance-rules";
import { applySuggestions } from "@/lib/rules/apply-suggestions";
import { requireUserId } from "@/lib/session";
import { householdAppliancePatchSchema } from "@/lib/validations/appliance";

type RouteParams = { params: Promise<{ unitId: string; applianceId: string }> };

const notFoundResponse = () =>
  NextResponse.json({ error: "Aparelho não encontrado" }, { status: 404 });

/**
 * Best-effort: uma falha no motor de regras não deve impedir a operação de
 * CRUD do aparelho em si (mesmo padrão de lib/process-bill.ts). As duas
 * chamadas são independentes (cada uma com seu próprio try/catch) para que
 * uma falha na primeira não impeça a segunda de rodar.
 */
async function recomputeApplianceRules(unitId: string) {
  try {
    await applyApplianceRules(unitId);
  } catch (error) {
    console.error(`applyApplianceRules failed for unit ${unitId}:`, error);
  }

  // Gera/atualiza as Suggestions imediatamente a partir dos achados de
  // aparelho recém-recalculados acima, em vez de só no próximo
  // processamento de fatura (apply-suggestions.ts é idempotente e seguro
  // para chamar a cada edição da varredura).
  try {
    await applySuggestions(unitId);
  } catch (error) {
    console.error(`applySuggestions failed for unit ${unitId}:`, error);
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { unitId, applianceId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = householdAppliancePatchSchema.safeParse(body);
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

  // Ownership + escopo à UC são verificados dentro do WHERE da própria
  // mutação (não em uma leitura separada) para evitar race condition entre
  // a checagem e a alteração.
  const { count } = await db.householdAppliance.updateMany({
    where: {
      id: applianceId,
      consumerUnitId: unitId,
      consumerUnit: { ownerId: userId },
    },
    data: parsed.data,
  });
  if (count === 0) {
    return notFoundResponse();
  }

  await recomputeApplianceRules(unitId);

  const appliance = await db.householdAppliance.findUnique({
    where: { id: applianceId },
  });
  return NextResponse.json({ appliance });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { unitId, applianceId } = await params;
  const { count } = await db.householdAppliance.deleteMany({
    where: {
      id: applianceId,
      consumerUnitId: unitId,
      consumerUnit: { ownerId: userId },
    },
  });
  if (count === 0) {
    return notFoundResponse();
  }

  await recomputeApplianceRules(unitId);

  return new NextResponse(null, { status: 204 });
}
