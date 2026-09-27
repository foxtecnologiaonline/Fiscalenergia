// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";

const { mockAuth, mockProcessBill } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockProcessBill: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/process-bill", () => ({
  processBill: mockProcessBill,
}));

import { POST as processRoute } from "@/app/api/bills/[billId]/process/route";

const TEST_EMAIL_MARKER = "bills-process-test";

function asUser(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId } });
}

function routeParams(billId: string) {
  return { params: Promise.resolve({ billId }) };
}

describe("POST /api/bills/[billId]/process", () => {
  let userAId: string;
  let userBId: string;
  let billId: string;

  beforeEach(async () => {
    mockAuth.mockReset();
    mockProcessBill.mockReset();

    // Scoped to this file's own users (cascades to their units/bills) so
    // parallel test files never wipe each other's fixtures.
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

    const unit = await db.consumerUnit.create({
      data: {
        ownerId: userAId,
        code: "UC-PROC-ROUTE",
        distributor: "Enel",
        uf: "SP",
        city: "São Paulo",
        tariffGroup: "B",
        tariffSubgroup: "B1",
        tariffModality: "Convencional",
      },
    });
    const bill = await db.bill.create({
      data: {
        consumerUnitId: unit.id,
        referenceMonth: new Date("2026-03-01T00:00:00.000Z"),
        fileUrl: "https://blob.example.com/fake-bill",
        status: "pending",
      },
    });
    billId = bill.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_MARKER } },
    });
    await db.$disconnect();
  });

  it("rejects unauthenticated requests", async () => {
    mockAuth.mockResolvedValue(null);
    const response = await processRoute(
      new Request("http://localhost", { method: "POST" }),
      routeParams(billId),
    );
    expect(response.status).toBe(401);
    expect(mockProcessBill).not.toHaveBeenCalled();
  });

  it("rejects a user who does not own the bill's UC", async () => {
    asUser(userBId);
    const response = await processRoute(
      new Request("http://localhost", { method: "POST" }),
      routeParams(billId),
    );
    expect(response.status).toBe(404);
    expect(mockProcessBill).not.toHaveBeenCalled();
  });

  it("returns 404 for a non-existent bill", async () => {
    asUser(userAId);
    const response = await processRoute(
      new Request("http://localhost", { method: "POST" }),
      routeParams("does-not-exist"),
    );
    expect(response.status).toBe(404);
  });

  it("processes the bill and returns it when the owner requests it", async () => {
    asUser(userAId);
    mockProcessBill.mockResolvedValue({ id: billId, status: "done" });

    const response = await processRoute(
      new Request("http://localhost", { method: "POST" }),
      routeParams(billId),
    );

    expect(response.status).toBe(200);
    const { bill } = await response.json();
    expect(bill.status).toBe("done");
    expect(mockProcessBill).toHaveBeenCalledWith(billId);
  });

  it("returns 409 when the bill is already processed or in progress", async () => {
    asUser(userAId);
    mockProcessBill.mockResolvedValue(null);

    const response = await processRoute(
      new Request("http://localhost", { method: "POST" }),
      routeParams(billId),
    );

    expect(response.status).toBe(409);
  });
});
