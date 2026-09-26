"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  BRAZILIAN_UFS,
  TARIFF_GROUPS,
} from "@/lib/validations/consumer-unit";

export type ConsumerUnitFormValues = {
  code: string;
  distributor: string;
  uf: string;
  city: string;
  tariffGroup: (typeof TARIFF_GROUPS)[number];
  tariffSubgroup: string;
  tariffModality: string;
  contractedDemandKw: number | null;
};

const emptyValues: ConsumerUnitFormValues = {
  code: "",
  distributor: "",
  uf: "",
  city: "",
  tariffGroup: "B",
  tariffSubgroup: "",
  tariffModality: "",
  contractedDemandKw: null,
};

type ConsumerUnitFormProps =
  | { mode: "create"; unitId?: undefined; initialValues?: undefined }
  | {
      mode: "edit";
      unitId: string;
      initialValues: ConsumerUnitFormValues;
    };

export function ConsumerUnitForm(props: ConsumerUnitFormProps) {
  const router = useRouter();
  const initial = props.mode === "edit" ? props.initialValues : emptyValues;

  const [values, setValues] = useState<ConsumerUnitFormValues>(initial);
  const [demandInput, setDemandInput] = useState(
    initial.contractedDemandKw != null ? String(initial.contractedDemandKw) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField<K extends keyof ConsumerUnitFormValues>(
    field: K,
    value: ConsumerUnitFormValues[K],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    // contractedDemandKw must be sent as `null` (never `undefined`) when empty:
    // JSON.stringify drops `undefined` keys, and Prisma treats a missing key as
    // "leave the stored value untouched" — which would keep a stale demand value
    // after switching a unit from group A back to group B.
    const payload = {
      ...values,
      contractedDemandKw: demandInput.trim() === "" ? null : Number(demandInput),
    };

    const endpoint =
      props.mode === "create"
        ? "/api/consumer-units"
        : `/api/consumer-units/${props.unitId}`;
    const method = props.mode === "create" ? "POST" : "PATCH";

    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setIsSubmitting(false);

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const fieldMessage: string | undefined = data?.issues?.[0]?.message;
      setError(
        fieldMessage ??
          data?.error ??
          "Não foi possível salvar a unidade consumidora",
      );
      return;
    }

    const data = await response.json();
    router.push(`/units/${data.unit.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="code">Código da UC</Label>
        <Input
          id="code"
          required
          value={values.code}
          onChange={(event) => updateField("code", event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="distributor">Distribuidora</Label>
        <Input
          id="distributor"
          required
          value={values.distributor}
          onChange={(event) => updateField("distributor", event.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="uf">UF</Label>
          <Select
            id="uf"
            required
            value={values.uf}
            onChange={(event) => updateField("uf", event.target.value)}
          >
            <option value="" disabled>
              Selecione
            </option>
            {BRAZILIAN_UFS.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="city">Cidade</Label>
          <Input
            id="city"
            required
            value={values.city}
            onChange={(event) => updateField("city", event.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="tariffGroup">Grupo tarifário</Label>
          <Select
            id="tariffGroup"
            required
            value={values.tariffGroup}
            onChange={(event) => {
              const group =
                event.target.value as ConsumerUnitFormValues["tariffGroup"];
              updateField("tariffGroup", group);
              if (group === "B") {
                setDemandInput("");
              }
            }}
          >
            {TARIFF_GROUPS.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="tariffSubgroup">Subgrupo tarifário</Label>
          <Input
            id="tariffSubgroup"
            required
            placeholder="Ex.: B1, A4"
            value={values.tariffSubgroup}
            onChange={(event) =>
              updateField("tariffSubgroup", event.target.value)
            }
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="tariffModality">Modalidade tarifária</Label>
        <Input
          id="tariffModality"
          required
          placeholder="Ex.: Convencional, Branca, Azul, Verde"
          value={values.tariffModality}
          onChange={(event) => updateField("tariffModality", event.target.value)}
        />
      </div>

      {values.tariffGroup === "A" ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="contractedDemandKw">Demanda contratada (kW)</Label>
          <Input
            id="contractedDemandKw"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={demandInput}
            onChange={(event) => setDemandInput(event.target.value)}
          />
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting
          ? "Salvando..."
          : props.mode === "create"
            ? "Cadastrar UC"
            : "Salvar alterações"}
      </Button>
    </form>
  );
}
