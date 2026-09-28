import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

import { POST as applySuggestion } from "@/app/api/suggestions/[suggestionId]/apply/route";

const TEST_EMAIL_MARKER = "suggestions-apply-test";
const TEST_DISTRIBUTOR = "Test Distribuidora Apply";

function jsonRequest(body: unknown) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeParams(suggestionId: string) {
  return { params: Promise.resolve({ suggestionId }) };
}

function asUser(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId } });
}

describe("POST /api/suggestions/[suggestionId]/apply", () => {
  let userAId: string;
  let userBId: string;
  let unitAId: string;

  beforeEach(async () => {
    mockAuth.mockReset();
    await db.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_MARKER } },
    });

    const userA = await db.user.create({
      data: {
        email: `user-a-${Date.now()}@${TEST_EMAIL_MARKER}.com`,
        passwordHash: "hash",
      },
    });
    const userB = await db.user.create({
      data: {
        email: `user-b-${Date.now()}@${TEST_EMAIL_MARKER}.com`,
        passwordHash: "hash",
      },
    });
    userAId = userA.id;
    userBId = userB.id;

    const unitA = await db.consumerUnit.create({
      data: {
        ownerId: userAId,
        code: "UC-APPLY-A",
        distributor: TEST_DISTRIBUTOR,
        uf: "SP",
        city: "São Paulo",
        tariffGroup: "B",
        tariffSubgroup: "B1",
        tariffModality: "Convencional",
      },
    });
    unitAId = unitA.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_MARKER } },
    });
    await db.$disconnect();
  });

  async function createSuggestion() {
    return db.suggestion.create({
      data: {
        consumerUnitId: unitAId,
        ruleCode: "billing.kwh_rate_mismatch",
        title: "Contestar tarifa de kWh cobrada incorretamente",
        description: "A tarifa cobrada diverge da homologada.",
        estimatedSavingsAmount: 30,
      },
    });
  }

  it("rejects unauthenticated requests", async () => {
    mockAuth.mockResolvedValue(null);
    const suggestion = await createSuggestion();
    const response = await applySuggestion(
      jsonRequest({ appliedNote: "Liguei para a distribuidora" }),
      routeParams(suggestion.id),
    );
    expect(response.status).toBe(401);
  });

  it("returns 404 for a non-existent suggestion", async () => {
    asUser(userAId);
    const response = await applySuggestion(
      jsonRequest({ appliedNote: "nota" }),
      routeParams("does-not-exist"),
    );
    expect(response.status).toBe(404);
  });

  it("returns 404 when the suggestion belongs to another user's UC", async () => {
    const suggestion = await createSuggestion();
    asUser(userBId);
    const response = await applySuggestion(
      jsonRequest({ appliedNote: "nota" }),
      routeParams(suggestion.id),
    );
    expect(response.status).toBe(404);
  });

  it("rejects an empty appliedNote", async () => {
    const suggestion = await createSuggestion();
    asUser(userAId);
    const response = await applySuggestion(
      jsonRequest({ appliedNote: "" }),
      routeParams(suggestion.id),
    );
    expect(response.status).toBe(400);
  });

  it("applies a suggestion with no prior bill (baselineBillId stays null)", async () => {
    const suggestion = await createSuggestion();
    asUser(userAId);
    const response = await applySuggestion(
      jsonRequest({ appliedNote: "Liguei para a distribuidora" }),
      routeParams(suggestion.id),
    );
    expect(response.status).toBe(200);
    const { suggestion: updated } = await response.json();
    expect(updated.status).toBe("applied");
    expect(updated.appliedNote).toBe("Liguei para a distribuidora");
    expect(updated.baselineBillId).toBeNull();
  });

  it("sets baselineBillId to the most recent done bill of the UC", async () => {
    await db.bill.create({
      data: {
        consumerUnitId: unitAId,
        referenceMonth: new Date("2026-01-01T00:00:00.000Z"),
        fileUrl: "https://blob.example.com/fake.pdf",
        status: "done",
        consumptionKwh: 300,
      },
    });
    const latestBill = await db.bill.create({
      data: {
        consumerUnitId: unitAId,
        referenceMonth: new Date("2026-02-01T00:00:00.000Z"),
        fileUrl: "https://blob.example.com/fake.pdf",
        status: "done",
        consumptionKwh: 320,
      },
    });
    const suggestion = await createSuggestion();

    asUser(userAId);
    const response = await applySuggestion(
      jsonRequest({ appliedNote: "Troquei a lâmpada" }),
      routeParams(suggestion.id),
    );
    expect(response.status).toBe(200);
    const { suggestion: updated } = await response.json();
    expect(updated.baselineBillId).toBe(latestBill.id);
  });

  it("returns 409 when applying an already-applied suggestion", async () => {
    const suggestion = await createSuggestion();
    asUser(userAId);

    const first = await applySuggestion(
      jsonRequest({ appliedNote: "primeira nota" }),
      routeParams(suggestion.id),
    );
    expect(first.status).toBe(200);

    const second = await applySuggestion(
      jsonRequest({ appliedNote: "segunda nota" }),
      routeParams(suggestion.id),
    );
    expect(second.status).toBe(409);

    const stored = await db.suggestion.findUnique({ where: { id: suggestion.id } });
    expect(stored?.appliedNote).toBe("primeira nota");
  });
});
