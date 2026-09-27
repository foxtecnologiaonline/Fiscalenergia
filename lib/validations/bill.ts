import { z } from "zod";

export const ACCEPTED_BILL_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export const MAX_BILL_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export type AcceptedBillFileType = (typeof ACCEPTED_BILL_FILE_TYPES)[number];

export function isAcceptedBillFileType(
  type: string,
): type is AcceptedBillFileType {
  return (ACCEPTED_BILL_FILE_TYPES as readonly string[]).includes(type);
}

const REFERENCE_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export const billUploadSchema = z.object({
  consumerUnitId: z.string().trim().min(1, "UC inválida"),
  referenceMonth: z
    .string()
    .regex(REFERENCE_MONTH_REGEX, "Informe o mês de referência (AAAA-MM)"),
});

export type BillUploadInput = z.infer<typeof billUploadSchema>;

export function referenceMonthToDate(referenceMonth: string): Date {
  const [year, month] = referenceMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

/**
 * Formats a referenceMonth Date as "MM/AAAA" using UTC getters, since the
 * value is stored as UTC midnight of the 1st — reading it back with local
 * getters could roll over to the previous month in negative UTC offsets
 * (e.g. Brazil).
 */
export function formatReferenceMonth(referenceMonth: Date): string {
  const month = String(referenceMonth.getUTCMonth() + 1).padStart(2, "0");
  const year = referenceMonth.getUTCFullYear();
  return `${month}/${year}`;
}
