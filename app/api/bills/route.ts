import { NextResponse } from "next/server";

import { uploadBillFile } from "@/lib/blob";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import {
  MAX_BILL_FILE_SIZE_BYTES,
  billUploadSchema,
  isAcceptedBillFileType,
  referenceMonthToDate,
} from "@/lib/validations/bill";

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const parsed = billUploadSchema.safeParse({
    consumerUnitId: formData.get("consumerUnitId"),
    referenceMonth: formData.get("referenceMonth"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: "Selecione um arquivo (PDF, JPG ou PNG)" },
      { status: 400 },
    );
  }
  if (!isAcceptedBillFileType(file.type)) {
    return NextResponse.json(
      { error: "Tipo de arquivo não suportado. Envie PDF, JPG ou PNG." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BILL_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: "Arquivo muito grande (máximo 20MB)." },
      { status: 400 },
    );
  }

  const { consumerUnitId, referenceMonth } = parsed.data;
  const unit = await db.consumerUnit.findUnique({
    where: { id: consumerUnitId },
  });
  if (!unit || unit.ownerId !== userId) {
    return NextResponse.json({ error: "UC não encontrada" }, { status: 404 });
  }

  let fileUrl: string;
  try {
    fileUrl = await uploadBillFile(unit.id, file);
  } catch {
    return NextResponse.json(
      { error: "Não foi possível enviar o arquivo. Tente novamente." },
      { status: 502 },
    );
  }

  const bill = await db.bill.create({
    data: {
      consumerUnitId: unit.id,
      referenceMonth: referenceMonthToDate(referenceMonth),
      fileUrl,
      status: "pending",
    },
  });

  return NextResponse.json({ bill }, { status: 201 });
}
