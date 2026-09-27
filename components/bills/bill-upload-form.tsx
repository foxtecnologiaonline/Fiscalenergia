"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ACCEPTED_BILL_FILE_TYPES,
  MAX_BILL_FILE_SIZE_BYTES,
  isAcceptedBillFileType,
} from "@/lib/validations/bill";

const ACCEPT_ATTR = ACCEPTED_BILL_FILE_TYPES.join(",");

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function BillUploadForm({
  consumerUnitId,
}: {
  consumerUnitId: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [referenceMonth, setReferenceMonth] = useState(currentMonthValue());
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const fileInput = event.currentTarget.elements.namedItem(
      "file",
    ) as HTMLInputElement;
    const file = fileInput.files?.[0];

    if (!file) {
      setError("Selecione um arquivo");
      return;
    }
    if (!isAcceptedBillFileType(file.type)) {
      setError("Tipo de arquivo não suportado. Envie PDF, JPG ou PNG.");
      return;
    }
    if (file.size > MAX_BILL_FILE_SIZE_BYTES) {
      setError("Arquivo muito grande (máximo 20MB).");
      return;
    }

    setIsSubmitting(true);

    const formData = new FormData();
    formData.set("consumerUnitId", consumerUnitId);
    formData.set("referenceMonth", referenceMonth);
    formData.set("file", file);

    const response = await fetch("/api/bills", {
      method: "POST",
      body: formData,
    });

    setIsSubmitting(false);

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const fieldMessage: string | undefined = data?.issues?.[0]?.message;
      setError(
        fieldMessage ?? data?.error ?? "Não foi possível enviar a fatura",
      );
      return;
    }

    formRef.current?.reset();
    router.refresh();
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="referenceMonth">Mês de referência</Label>
          <Input
            id="referenceMonth"
            name="referenceMonth"
            type="month"
            required
            value={referenceMonth}
            onChange={(event) => setReferenceMonth(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="file">Arquivo da fatura</Label>
          <Input
            id="file"
            name="file"
            type="file"
            accept={ACCEPT_ATTR}
            required
          />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full sm:w-auto"
      >
        {isSubmitting ? "Enviando..." : "Enviar fatura"}
      </Button>
    </form>
  );
}
