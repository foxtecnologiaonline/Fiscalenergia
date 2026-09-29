"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function EmailNotificationsToggle({
  initialEnabled,
}: {
  initialEnabled: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(checked: boolean) {
    setEnabled(checked);
    setError(null);
    setIsSaving(true);

    const response = await fetch("/api/account/email-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailNotificationsEnabled: checked }),
    });

    setIsSaving(false);

    if (!response.ok) {
      setEnabled(!checked);
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Não foi possível salvar a preferência");
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={enabled}
          disabled={isSaving}
          onChange={(event) => handleChange(event.target.checked)}
        />
        Receber notificações por e-mail (processamento de fatura, achados de
        severidade alta e avaliação de sugestões aplicadas)
      </label>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
