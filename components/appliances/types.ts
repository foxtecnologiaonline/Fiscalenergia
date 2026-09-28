import type { ApplianceCondition, Room } from "@/lib/validations/appliance";

export type CatalogItem = {
  id: string;
  room: Room;
  name: string;
  category: string;
  typicalPowerW: number;
  typicalUsageHoursPerDay: number;
  typicalUsageDaysPerWeek: number;
  referenceKwhMonth: number | null;
  notes: string | null;
};

export type SavedAppliance = {
  id: string;
  catalogId: string | null;
  name: string;
  room: string;
  powerW: number;
  usageHoursPerDay: number;
  usageDaysPerWeek: number;
  quantity: number;
  ageYears: number | null;
  lastMaintenanceAt: string | null;
  condition: ApplianceCondition;
  isCustom: boolean;
};
