"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function ApplySuggestionForm({ suggestionId }: { suggestionId: string }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [appliedNote, setAppliedNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const response = await fetch(`/api/suggestions/${suggestionId}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appliedNote }),
    });

    setIsSubmitting(false);

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const fieldMessage: string | undefined = data?.issues?.[0]?.message;
      setError(
        fieldMessage ?? data?.error ?? "Não foi possível marcar como aplicada",
      );
      return;
    }

    setIsOpen(false);
    setAppliedNote("");
    router.refresh();
  }

  if (!isOpen) {
    return (
      <Button type="button" size="sm" onClick={() => setIsOpen(true)}>
        Marcar como aplicada
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <textarea
        required
        autoFocus
        placeholder="O que você fez? (ex.: troquei a geladeira, ajustei o uso do ar-condicionado)"
        value={appliedNote}
        onChange={(event) => setAppliedNote(event.target.value)}
        className="min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
      />
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting ? "Salvando..." : "Confirmar"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isSubmitting}
          onClick={() => {
            setIsOpen(false);
            setError(null);
          }}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
