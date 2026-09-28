import { z } from "zod";

export const TARIFF_FLAGS = [
  "verde",
  "amarela",
  "vermelha_p1",
  "vermelha_p2",
] as const;

export const lineItemSchema = z.object({
  description: z.string(),
  quantity: z.number().nullable(),
  unitRate: z.number().nullable(),
  amount: z.number().nullable(),
});

// Mirrors the extractable fields on Bill (see prisma/schema.prisma). Every
// field is nullable on purpose: the extraction prompt instructs Claude to
// return null instead of guessing when it isn't confident about a value.
export const extractedBillSchema = z.object({
  totalAmount: z.number().nullable(),
  consumptionKwh: z.number().nullable(),
  tariffFlag: z.enum(TARIFF_FLAGS).nullable(),
  previousReadingKwh: z.number().nullable(),
  currentReadingKwh: z.number().nullable(),
  billingDays: z.number().int().nullable(),
  appliedKwhRate: z.number().nullable(),
  lineItems: z.array(lineItemSchema),
});

export type ExtractedBill = z.infer<typeof extractedBillSchema>;
export type LineItem = z.infer<typeof lineItemSchema>;

// Bill.lineItems is a Json column — safely parse it back into LineItem[]
// instead of casting, since nothing at the DB layer guarantees its shape.
export function parseLineItems(value: unknown): LineItem[] {
  const result = z.array(lineItemSchema).safeParse(value);
  return result.success ? result.data : [];
}
