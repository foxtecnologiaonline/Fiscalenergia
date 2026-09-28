import { z } from "zod";

// Cômodos padrão do questionário de varredura (ver docs/SCOPE.md). Usado
// tanto para filtrar o ApplianceCatalog por cômodo quanto para rotular as
// etapas do assistente na UI.
export const ROOMS = [
  "cozinha",
  "sala",
  "quarto",
  "banheiro",
  "area_servico",
  "escritorio",
  "area_externa",
] as const;

export type Room = (typeof ROOMS)[number];

export const ROOM_LABELS: Record<Room, string> = {
  cozinha: "Cozinha",
  sala: "Sala",
  quarto: "Quarto",
  banheiro: "Banheiro",
  area_servico: "Área de serviço/Lavanderia",
  escritorio: "Escritório/Home office",
  area_externa: "Área externa/Garagem",
};

// Único cômodo padrão repetível por quantidade de instâncias (ex.: "Quarto
// 1", "Quarto 2") — os demais aparecem uma única vez no assistente.
export const REPEATABLE_ROOM: Room = "quarto";

export const APPLIANCE_CONDITIONS = [
  "novo",
  "normal",
  "antigo",
  "sem_manutencao",
] as const;

export type ApplianceCondition = (typeof APPLIANCE_CONDITIONS)[number];

export const APPLIANCE_CONDITION_LABELS: Record<ApplianceCondition, string> = {
  novo: "Novo",
  normal: "Normal",
  antigo: "Antigo",
  sem_manutencao: "Sem manutenção",
};

const dateStringToDate = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Data inválida")
  .transform((value) => new Date(value));

export const householdApplianceSchema = z.object({
  catalogId: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().min(1, "Informe o nome do aparelho").max(120),
  room: z.string().trim().min(1, "Informe o cômodo").max(60),
  powerW: z.number("Informe a potência").nonnegative(
    "A potência não pode ser negativa",
  ),
  usageHoursPerDay: z
    .number("Informe as horas de uso por dia")
    .min(0, "As horas de uso não podem ser negativas")
    .max(24, "Não é possível usar por mais de 24h por dia"),
  usageDaysPerWeek: z
    .number("Informe os dias de uso por semana")
    .min(0, "Os dias de uso não podem ser negativos")
    .max(7, "Não é possível usar por mais de 7 dias por semana"),
  quantity: z
    .number("Informe a quantidade")
    .int("A quantidade deve ser um número inteiro")
    .min(0, "A quantidade não pode ser negativa")
    .max(100, "Quantidade muito alta"),
  ageYears: z
    .number()
    .min(0, "A idade não pode ser negativa")
    .max(100, "Idade muito alta")
    .nullable()
    .optional(),
  lastMaintenanceAt: dateStringToDate.nullable().optional(),
  condition: z.enum(APPLIANCE_CONDITIONS, "Condição inválida").default("normal"),
  isCustom: z.boolean().default(false),
});

export type HouseholdApplianceInput = z.infer<typeof householdApplianceSchema>;

export const householdAppliancePatchSchema = householdApplianceSchema.partial();

export type HouseholdAppliancePatchInput = z.infer<
  typeof householdAppliancePatchSchema
>;
