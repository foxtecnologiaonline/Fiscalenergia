import { describe, expect, it } from "vitest";

import { loginSchema, registerSchema } from "@/lib/validations/auth";

describe("registerSchema", () => {
  it("accepts a valid payload", () => {
    const result = registerSchema.safeParse({
      name: "Ana Silva",
      email: "Ana@Example.com",
      password: "supersecret123",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("ana@example.com");
    }
  });

  it("rejects an invalid e-mail", () => {
    const result = registerSchema.safeParse({
      name: "Ana Silva",
      email: "not-an-email",
      password: "supersecret123",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a password shorter than 8 characters", () => {
    const result = registerSchema.safeParse({
      name: "Ana Silva",
      email: "ana@example.com",
      password: "short",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an empty name", () => {
    const result = registerSchema.safeParse({
      name: "  ",
      email: "ana@example.com",
      password: "supersecret123",
    });

    expect(result.success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("accepts a valid payload", () => {
    const result = loginSchema.safeParse({
      email: "ana@example.com",
      password: "anything",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a missing password", () => {
    const result = loginSchema.safeParse({
      email: "ana@example.com",
      password: "",
    });

    expect(result.success).toBe(false);
  });
});
