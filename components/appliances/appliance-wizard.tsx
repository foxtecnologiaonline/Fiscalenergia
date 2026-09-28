"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { RoomForm } from "@/components/appliances/room-form";
import type { CatalogItem, SavedAppliance } from "@/components/appliances/types";
import { REPEATABLE_ROOM, ROOMS, ROOM_LABELS, type Room } from "@/lib/validations/appliance";

type RoomInstance = { key: string; roomType: Room; label: string };

function bedroomNumber(label: string): number {
  const parsed = Number(label.split(" ").pop());
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildBaseRoomInstances(appliances: SavedAppliance[]): RoomInstance[] {
  const bedroomPrefix = ROOM_LABELS[REPEATABLE_ROOM];
  const bedroomLabels = new Set(
    appliances
      .filter((appliance) => appliance.room.startsWith(`${bedroomPrefix} `))
      .map((appliance) => appliance.room),
  );
  if (bedroomLabels.size === 0) {
    bedroomLabels.add(`${bedroomPrefix} 1`);
  }
  const sortedBedrooms = [...bedroomLabels].sort(
    (a, b) => bedroomNumber(a) - bedroomNumber(b),
  );

  const instances: RoomInstance[] = [];
  for (const room of ROOMS) {
    if (room === REPEATABLE_ROOM) {
      for (const label of sortedBedrooms) {
        instances.push({ key: label, roomType: room, label });
      }
    } else {
      instances.push({ key: room, roomType: room, label: ROOM_LABELS[room] });
    }
  }
  return instances;
}

export function ApplianceWizard({
  unitId,
  catalog,
  appliances,
}: {
  unitId: string;
  catalog: CatalogItem[];
  appliances: SavedAppliance[];
}) {
  const router = useRouter();
  const [extraBedrooms, setExtraBedrooms] = useState<string[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const roomInstances = useMemo(() => {
    const base = buildBaseRoomInstances(appliances);
    const lastBedroomIndex = base
      .map((instance) => instance.roomType)
      .lastIndexOf(REPEATABLE_ROOM);
    const added = extraBedrooms
      .filter((label) => !base.some((instance) => instance.label === label))
      .map((label) => ({ key: label, roomType: REPEATABLE_ROOM, label }));
    return [
      ...base.slice(0, lastBedroomIndex + 1),
      ...added,
      ...base.slice(lastBedroomIndex + 1),
    ];
  }, [appliances, extraBedrooms]);

  const activeInstance =
    roomInstances.find((instance) => instance.key === activeKey) ?? roomInstances[0];

  const appliancesByRoom = useMemo(() => {
    const map = new Map<string, SavedAppliance[]>();
    for (const appliance of appliances) {
      const list = map.get(appliance.room) ?? [];
      list.push(appliance);
      map.set(appliance.room, list);
    }
    return map;
  }, [appliances]);

  const catalogByRoomType = useMemo(() => {
    const map = new Map<Room, CatalogItem[]>();
    for (const item of catalog) {
      const list = map.get(item.room) ?? [];
      list.push(item);
      map.set(item.room, list);
    }
    return map;
  }, [catalog]);

  function addBedroom() {
    const bedroomPrefix = ROOM_LABELS[REPEATABLE_ROOM];
    const existingNumbers = roomInstances
      .filter((instance) => instance.roomType === REPEATABLE_ROOM)
      .map((instance) => bedroomNumber(instance.label));
    const nextNumber =
      existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
    const label = `${bedroomPrefix} ${nextNumber}`;
    setExtraBedrooms((current) => [...current, label]);
    setActiveKey(label);
  }

  function goToNextRoom() {
    const currentIndex = roomInstances.findIndex(
      (instance) => instance.key === activeInstance.key,
    );
    const next = roomInstances[currentIndex + 1];
    if (next) {
      setActiveKey(next.key);
    }
  }

  const activeSaved = appliancesByRoom.get(activeInstance.label) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        {roomInstances.map((instance) => {
          const savedCount = appliancesByRoom.get(instance.label)?.length ?? 0;
          const isActive = instance.key === activeInstance.key;
          return (
            <button
              key={instance.key}
              type="button"
              onClick={() => setActiveKey(instance.key)}
              className={`rounded-full border px-3 py-1 text-sm ${
                isActive
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input text-foreground"
              }`}
            >
              {instance.label}
              {savedCount > 0 ? ` (${savedCount})` : ""}
            </button>
          );
        })}
        <Button type="button" variant="outline" size="sm" onClick={addBedroom}>
          + Quarto
        </Button>
      </div>

      <RoomForm
        key={`${activeInstance.key}:${activeSaved.map((a) => a.id).join(",")}`}
        unitId={unitId}
        roomLabel={activeInstance.label}
        catalogItems={catalogByRoomType.get(activeInstance.roomType) ?? []}
        savedAppliances={activeSaved}
        onSaved={() => router.refresh()}
        onSavedAndContinue={() => {
          router.refresh();
          goToNextRoom();
        }}
      />
    </div>
  );
}
