import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

import {
  GET as listUnits,
  POST as createUnit,
} from "@/app/api/consumer-units/route";
import {
  DELETE as deleteUnit,
  GET as getUnit,
  PATCH as updateUnit,
} from "@/app/api/consumer-units/[unitId]/route";

const TEST_EMAIL_MARKER = "consumer-units-test";

function jsonRequest(body: unknown, method = "POST") {
  return new Request("http://localhost/api/consumer-units", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeParams(unitId: string) {
  return { params: Promise.resolve({ unitId }) };
}

function asUser(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId } });
}

const validPayload = {
  code: "UC-100",
  distributor: "Enel",
  uf: "SP",
  city: "São Paulo",
  tariffGroup: "B" as const,
  tariffSubgroup: "B1",
  tariffModality: "Convencional",
};

describe("/api/consumer-units", () => {
  let userAId: string;
  let userBId: string;

  beforeEach(async () => {
    mockAuth.mockReset();
    await db.consumerUnit.deleteMany({});
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
  });

  afterAll(async () => {
    await db.consumerUnit.deleteMany({});
    await db.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_MARKER } },
    });
    await db.$disconnect();
  });

  it("rejects unauthenticated requests to list", async () => {
    mockAuth.mockResolvedValue(null);
    const response = await listUnits();
    expect(response.status).toBe(401);
  });

  it("rejects unauthenticated requests to create", async () => {
    mockAuth.mockResolvedValue(null);
    const response = await createUnit(jsonRequest(validPayload));
    expect(response.status).toBe(401);
  });

  it("creates a unit and lists only the current user's units", async () => {
    asUser(userAId);
    const createResponse = await createUnit(jsonRequest(validPayload));
    expect(createResponse.status).toBe(201);

    asUser(userBId);
    await createUnit(jsonRequest({ ...validPayload, code: "UC-200" }));

    asUser(userAId);
    const listResponse = await listUnits();
    expect(listResponse.status).toBe(200);
    const { units } = await listResponse.json();
    expect(units).toHaveLength(1);
    expect(units[0].code).toBe("UC-100");
  });

  it("rejects invalid payloads with 400", async () => {
    asUser(userAId);
    const response = await createUnit(
      jsonRequest({ ...validPayload, uf: "XX" }),
    );
    expect(response.status).toBe(400);
  });

  it("requires contractedDemandKw for group A units", async () => {
    asUser(userAId);
    const response = await createUnit(
      jsonRequest({ ...validPayload, code: "UC-A1", tariffGroup: "A" }),
    );
    expect(response.status).toBe(400);
  });

  it("accepts group A units with contractedDemandKw", async () => {
    asUser(userAId);
    const response = await createUnit(
      jsonRequest({
        ...validPayload,
        code: "UC-A1",
        tariffGroup: "A",
        contractedDemandKw: 150,
      }),
    );
    expect(response.status).toBe(201);
  });

  it("rejects a duplicate code for the same owner with 409", async () => {
    asUser(userAId);
    await createUnit(jsonRequest(validPayload));
    const response = await createUnit(jsonRequest(validPayload));
    expect(response.status).toBe(409);
  });

  it("allows the same code across different owners", async () => {
    asUser(userAId);
    const first = await createUnit(jsonRequest(validPayload));
    expect(first.status).toBe(201);

    asUser(userBId);
    const second = await createUnit(jsonRequest(validPayload));
    expect(second.status).toBe(201);
  });

  it("prevents a user from reading another user's unit", async () => {
    asUser(userAId);
    const createResponse = await createUnit(jsonRequest(validPayload));
    const { unit } = await createResponse.json();

    asUser(userBId);
    const response = await getUnit(
      new Request("http://localhost"),
      routeParams(unit.id),
    );
    expect(response.status).toBe(404);
  });

  it("prevents a user from updating another user's unit", async () => {
    asUser(userAId);
    const createResponse = await createUnit(jsonRequest(validPayload));
    const { unit } = await createResponse.json();

    asUser(userBId);
    const response = await updateUnit(
      jsonRequest({ ...validPayload, city: "Rio de Janeiro" }, "PATCH"),
      routeParams(unit.id),
    );
    expect(response.status).toBe(404);

    const stillOriginal = await db.consumerUnit.findUnique({
      where: { id: unit.id },
    });
    expect(stillOriginal?.city).toBe("São Paulo");
  });

  it("prevents a user from deleting another user's unit", async () => {
    asUser(userAId);
    const createResponse = await createUnit(jsonRequest(validPayload));
    const { unit } = await createResponse.json();

    asUser(userBId);
    const response = await deleteUnit(
      new Request("http://localhost"),
      routeParams(unit.id),
    );
    expect(response.status).toBe(404);

    const stillExists = await db.consumerUnit.findUnique({
      where: { id: unit.id },
    });
    expect(stillExists).not.toBeNull();
  });

  it("returns 404 for a non-existent unit id", async () => {
    asUser(userAId);
    const response = await getUnit(
      new Request("http://localhost"),
      routeParams("does-not-exist"),
    );
    expect(response.status).toBe(404);
  });

  it("allows the owner to fetch, update and delete their unit", async () => {
    asUser(userAId);
    const createResponse = await createUnit(jsonRequest(validPayload));
    const { unit } = await createResponse.json();

    const getResponse = await getUnit(
      new Request("http://localhost"),
      routeParams(unit.id),
    );
    expect(getResponse.status).toBe(200);

    const updateResponse = await updateUnit(
      jsonRequest({ ...validPayload, city: "Campinas" }, "PATCH"),
      routeParams(unit.id),
    );
    expect(updateResponse.status).toBe(200);
    const { unit: updated } = await updateResponse.json();
    expect(updated.city).toBe("Campinas");

    const deleteResponse = await deleteUnit(
      new Request("http://localhost"),
      routeParams(unit.id),
    );
    expect(deleteResponse.status).toBe(204);

    const afterDelete = await db.consumerUnit.findUnique({
      where: { id: unit.id },
    });
    expect(afterDelete).toBeNull();
  });
});
