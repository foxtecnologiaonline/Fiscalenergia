"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function DeleteConsumerUnitButton({ unitId }: { unitId: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!window.confirm("Tem certeza que deseja excluir esta UC?")) {
      return;
    }

    setIsDeleting(true);
    setError(null);

    const response = await fetch(`/api/consumer-units/${unitId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Não foi possível excluir a UC");
      setIsDeleting(false);
      return;
    }

    router.push("/units");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        variant="destructive"
        onClick={handleDelete}
        disabled={isDeleting}
      >
        {isDeleting ? "Excluindo..." : "Excluir UC"}
      </Button>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
