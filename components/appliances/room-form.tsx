"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { estimateMonthlyKwh } from "@/lib/calculations";
import {
  APPLIANCE_CONDITIONS,
  APPLIANCE_CONDITION_LABELS,
  type ApplianceCondition,
} from "@/lib/validations/appliance";
import type { CatalogItem, SavedAppliance } from "@/components/appliances/types";

type Row = {
  key: string;
  isCustom: boolean;
  catalogId: string | null;
  applianceId: string | null;
  name: string;
  included: boolean;
  removed: boolean;
  powerW: number;
  usageHoursPerDay: number;
  usageDaysPerWeek: number;
  quantity: number;
  condition: ApplianceCondition;
};

function buildInitialRows(
  catalogItems: CatalogItem[],
  savedAppliances: SavedAppliance[],
): Row[] {
  const savedByCatalogId = new Map<string, SavedAppliance>();
  const customSaved: SavedAppliance[] = [];
  for (const appliance of savedAppliances) {
    if (appliance.catalogId) {
      savedByCatalogId.set(appliance.catalogId, appliance);
    } else {
      customSaved.push(appliance);
    }
  }

  const catalogRows: Row[] = catalogItems.map((item) => {
    const saved = savedByCatalogId.get(item.id);
    return {
      key: item.id,
      isCustom: false,
      catalogId: item.id,
      applianceId: saved?.id ?? null,
      name: item.name,
      included: Boolean(saved),
      removed: false,
      powerW: saved?.powerW ?? item.typicalPowerW,
      usageHoursPerDay: saved?.usageHoursPerDay ?? item.typicalUsageHoursPerDay,
      usageDaysPerWeek: saved?.usageDaysPerWeek ?? item.typicalUsageDaysPerWeek,
      quantity: saved?.quantity ?? 1,
      condition: saved?.condition ?? "normal",
    };
  });

  const customRows: Row[] = customSaved.map((appliance) => ({
    key: appliance.id,
    isCustom: true,
    catalogId: null,
    applianceId: appliance.id,
    name: appliance.name,
    included: true,
    removed: false,
    powerW: appliance.powerW,
    usageHoursPerDay: appliance.usageHoursPerDay,
    usageDaysPerWeek: appliance.usageDaysPerWeek,
    quantity: appliance.quantity,
    condition: appliance.condition,
  }));

  return [...catalogRows, ...customRows];
}

async function sendAppliance(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: Record<string, unknown>,
) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const fieldMessage: string | undefined = data?.issues?.[0]?.message;
    throw new Error(fieldMessage ?? data?.error ?? "Não foi possível salvar");
  }
}

let customRowCounter = 0;

export function RoomForm({
  unitId,
  roomLabel,
  catalogItems,
  savedAppliances,
  onSaved,
  onSavedAndContinue,
}: {
  unitId: string;
  roomLabel: string;
  catalogItems: CatalogItem[];
  savedAppliances: SavedAppliance[];
  onSaved: () => void;
  onSavedAndContinue: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    buildInitialRows(catalogItems, savedAppliances),
  );
  const [customName, setCustomName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function addCustomRow() {
    if (!customName.trim()) return;
    customRowCounter += 1;
    setRows((current) => [
      ...current,
      {
        key: `new-custom-${customRowCounter}`,
        isCustom: true,
        catalogId: null,
        applianceId: null,
        name: customName.trim(),
        included: true,
        removed: false,
        powerW: 0,
        usageHoursPerDay: 0,
        usageDaysPerWeek: 0,
        quantity: 1,
        condition: "normal",
      },
    ]);
    setCustomName("");
  }

  function removeCustomRow(key: string) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, removed: true } : row)),
    );
  }

  async function handleSave(advance: boolean) {
    setError(null);
    setIsSaving(true);
    try {
      for (const row of rows) {
        const baseUrl = `/api/consumer-units/${unitId}/appliances`;

        if (row.removed) {
          if (row.applianceId) {
            await sendAppliance(`${baseUrl}/${row.applianceId}`, "DELETE");
          }
          continue;
        }

        if (!row.isCustom && !row.included) {
          if (row.applianceId) {
            await sendAppliance(`${baseUrl}/${row.applianceId}`, "DELETE");
          }
          continue;
        }

        const payload = {
          catalogId: row.catalogId,
          name: row.name,
          room: roomLabel,
          powerW: row.powerW,
          usageHoursPerDay: row.usageHoursPerDay,
          usageDaysPerWeek: row.usageDaysPerWeek,
          quantity: row.quantity,
          condition: row.condition,
          isCustom: row.isCustom,
        };

        if (row.applianceId) {
          await sendAppliance(`${baseUrl}/${row.applianceId}`, "PATCH", payload);
        } else {
          await sendAppliance(baseUrl, "POST", payload);
        }
      }

      if (advance) {
        onSavedAndContinue();
      } else {
        onSaved();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Não foi possível salvar este cômodo",
      );
    } finally {
      setIsSaving(false);
    }
  }

  const visibleRows = rows.filter((row) => !row.removed);
  const roomTotalKwh = visibleRows
    .filter((row) => row.isCustom || row.included)
    .reduce((sum, row) => sum + estimateMonthlyKwh(row), 0);

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{roomLabel}</h2>
        <p className="text-sm text-muted-foreground">
          Subtotal: {roomTotalKwh.toFixed(1)} kWh/mês
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2 pr-2 font-medium">Tenho</th>
              <th className="py-2 pr-2 font-medium">Aparelho</th>
              <th className="py-2 pr-2 font-medium">Potência (W)</th>
              <th className="py-2 pr-2 font-medium">Horas/dia</th>
              <th className="py-2 pr-2 font-medium">Dias/semana</th>
              <th className="py-2 pr-2 font-medium">Qtd.</th>
              <th className="py-2 pr-2 font-medium">Condição</th>
              <th className="py-2 pr-2 font-medium">≈ kWh/mês</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.key} className="border-t">
                <td className="py-2 pr-2">
                  {row.isCustom ? null : (
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={row.included}
                      onChange={(event) =>
                        updateRow(row.key, { included: event.target.checked })
                      }
                      aria-label={`Tenho ${row.name}`}
                    />
                  )}
                </td>
                <td className="py-2 pr-2 whitespace-nowrap">{row.name}</td>
                <td className="py-2 pr-2">
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    className="w-24"
                    value={row.powerW}
                    disabled={!row.isCustom && !row.included}
                    onChange={(event) =>
                      updateRow(row.key, { powerW: Number(event.target.value) })
                    }
                  />
                </td>
                <td className="py-2 pr-2">
                  <Input
                    type="number"
                    min="0"
                    max="24"
                    step="0.1"
                    className="w-20"
                    value={row.usageHoursPerDay}
                    disabled={!row.isCustom && !row.included}
                    onChange={(event) =>
                      updateRow(row.key, {
                        usageHoursPerDay: Number(event.target.value),
                      })
                    }
                  />
                </td>
                <td className="py-2 pr-2">
                  <Input
                    type="number"
                    min="0"
                    max="7"
                    step="0.5"
                    className="w-20"
                    value={row.usageDaysPerWeek}
                    disabled={!row.isCustom && !row.included}
                    onChange={(event) =>
                      updateRow(row.key, {
                        usageDaysPerWeek: Number(event.target.value),
                      })
                    }
                  />
                </td>
                <td className="py-2 pr-2">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    className="w-16"
                    value={row.quantity}
                    disabled={!row.isCustom && !row.included}
                    onChange={(event) =>
                      updateRow(row.key, { quantity: Number(event.target.value) })
                    }
                  />
                </td>
                <td className="py-2 pr-2">
                  <Select
                    className="w-36"
                    value={row.condition}
                    disabled={!row.isCustom && !row.included}
                    onChange={(event) =>
                      updateRow(row.key, {
                        condition: event.target.value as ApplianceCondition,
                      })
                    }
                  >
                    {APPLIANCE_CONDITIONS.map((condition) => (
                      <option key={condition} value={condition}>
                        {APPLIANCE_CONDITION_LABELS[condition]}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="py-2 pr-2 whitespace-nowrap text-muted-foreground">
                  {row.isCustom || row.included
                    ? estimateMonthlyKwh(row).toFixed(1)
                    : "—"}
                </td>
                <td className="py-2">
                  {row.isCustom ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeCustomRow(row.key)}
                    >
                      Remover
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t pt-4">
        <div className="flex flex-col gap-2">
          <label
            htmlFor={`custom-name-${roomLabel}`}
            className="text-sm text-muted-foreground"
          >
            Adicionar outro aparelho não listado
          </label>
          <Input
            id={`custom-name-${roomLabel}`}
            placeholder="Nome do aparelho"
            value={customName}
            onChange={(event) => setCustomName(event.target.value)}
          />
        </div>
        <Button type="button" variant="outline" onClick={addCustomRow}>
          Adicionar
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={isSaving} onClick={() => handleSave(false)}>
          {isSaving ? "Salvando..." : "Salvar cômodo"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isSaving}
          onClick={() => handleSave(true)}
        >
          Salvar e ir para o próximo cômodo
        </Button>
      </div>
    </div>
  );
}
