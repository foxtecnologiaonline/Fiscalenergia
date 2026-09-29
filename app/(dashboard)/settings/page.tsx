import { redirect } from "next/navigation";

import { EmailNotificationsToggle } from "@/components/settings/email-notifications-toggle";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const user = await db.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { email: true, emailNotificationsEnabled: true },
  });

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <p className="text-muted-foreground">{user.email}</p>
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="mb-3 text-lg font-semibold">Notificações</h2>
        <EmailNotificationsToggle
          initialEnabled={user.emailNotificationsEnabled}
        />
      </div>
    </div>
  );
}
