import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { emailPreferencesSchema } from "@/lib/validations/account";

export async function PATCH(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = emailPreferencesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const user = await db.user.update({
    where: { id: userId },
    data: { emailNotificationsEnabled: parsed.data.emailNotificationsEnabled },
    select: { emailNotificationsEnabled: true },
  });

  return NextResponse.json({ user });
}
