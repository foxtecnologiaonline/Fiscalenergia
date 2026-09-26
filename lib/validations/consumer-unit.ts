import { z } from "zod";

export const BRAZILIAN_UFS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;

export const TARIFF_GROUPS = ["A", "B"] as const;

export const consumerUnitSchema = z
  .object({
    code: z.string().trim().min(1, "Informe o código da UC").max(60),
    distributor: z.string().trim().min(1, "Informe a distribuidora").max(120),
    uf: z.enum(BRAZILIAN_UFS, "UF inválida"),
    city: z.string().trim().min(1, "Informe a cidade").max(120),
    tariffGroup: z.enum(TARIFF_GROUPS, "Grupo tarifário inválido"),
    tariffSubgroup: z
      .string()
      .trim()
      .min(1, "Informe o subgrupo tarifário")
      .max(20),
    tariffModality: z
      .string()
      .trim()
      .min(1, "Informe a modalidade tarifária")
      .max(60),
    contractedDemandKw: z
      .number("Informe um número válido")
      .positive("A demanda contratada deve ser maior que zero")
      .optional()
      .nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.tariffGroup === "A" && !data.contractedDemandKw) {
      ctx.addIssue({
        code: "custom",
        message: "Demanda contratada é obrigatória para o grupo tarifário A",
        path: ["contractedDemandKw"],
      });
    }
  });

export type ConsumerUnitInput = z.infer<typeof consumerUnitSchema>;
