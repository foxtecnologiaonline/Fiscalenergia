import { describe, expect, it } from "vitest";

import { consumerUnitSchema } from "@/lib/validations/consumer-unit";

const baseInput = {
  code: "UC-001",
  distributor: "Enel",
  uf: "SP",
  city: "São Paulo",
  tariffSubgroup: "B1",
  tariffModality: "Convencional",
};

describe("consumerUnitSchema", () => {
  it("accepts a valid group B unit without contractedDemandKw", () => {
    const result = consumerUnitSchema.safeParse({
      ...baseInput,
      tariffGroup: "B",
    });

    expect(result.success).toBe(true);
  });

  it("accepts an explicit null contractedDemandKw for group B", () => {
    const result = consumerUnitSchema.safeParse({
      ...baseInput,
      tariffGroup: "B",
      contractedDemandKw: null,
    });

    expect(result.success).toBe(true);
  });

  it("rejects an explicit null contractedDemandKw for group A", () => {
    const result = consumerUnitSchema.safeParse({
      ...baseInput,
      tariffGroup: "A",
      contractedDemandKw: null,
    });

    expect(result.success).toBe(false);
  });

  it("accepts a valid group A unit with contractedDemandKw", () => {
    const result = consumerUnitSchema.safeParse({
      ...baseInput,
      tariffGroup: "A",
      contractedDemandKw: 150,
    });

    expect(result.success).toBe(true);
  });

  it("rejects group A without contractedDemandKw", () => {
    const result = consumerUnitSchema.safeParse({
      ...baseInput,
      tariffGroup: "A",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.path.includes("contractedDemandKw"),
        ),
      ).toBe(true);
    }
  });

  it("rejects a non-positive contractedDemandKw", () => {
    const result = consumerUnitSchema.safeParse({
      ...baseInput,
      tariffGroup: "A",
      contractedDemandKw: 0,
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid UF", () => {
    const result = consumerUnitSchema.safeParse({
      ...baseInput,
      uf: "XX",
      tariffGroup: "B",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid tariffGroup", () => {
    const result = consumerUnitSchema.safeParse({
      ...baseInput,
      tariffGroup: "C",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an empty code", () => {
    const result = consumerUnitSchema.safeParse({
      ...baseInput,
      code: "  ",
      tariffGroup: "B",
    });

    expect(result.success).toBe(false);
  });
});
