import { describe, expect, it } from "vitest";

import {
  billUploadSchema,
  referenceMonthToDate,
} from "@/lib/validations/bill";

describe("billUploadSchema", () => {
  it("accepts a valid payload", () => {
    const result = billUploadSchema.safeParse({
      consumerUnitId: "unit-1",
      referenceMonth: "2026-03",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a missing consumerUnitId", () => {
    const result = billUploadSchema.safeParse({
      consumerUnitId: "",
      referenceMonth: "2026-03",
    });

    expect(result.success).toBe(false);
  });

  it.each(["2026-3", "2026-13", "2026-00", "26-03", "2026/03", ""])(
    "rejects an invalid referenceMonth: %s",
    (referenceMonth) => {
      const result = billUploadSchema.safeParse({
        consumerUnitId: "unit-1",
        referenceMonth,
      });

      expect(result.success).toBe(false);
    },
  );
});

describe("referenceMonthToDate", () => {
  it("normalizes to the first day of the month in UTC", () => {
    const date = referenceMonthToDate("2026-03");
    expect(date.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("handles December correctly", () => {
    const date = referenceMonthToDate("2025-12");
    expect(date.toISOString()).toBe("2025-12-01T00:00:00.000Z");
  });
});
