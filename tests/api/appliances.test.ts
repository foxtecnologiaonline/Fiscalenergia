import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

import { GET as getCatalog } from "@/app/api/appliance-catalog/route";
import {
  GET as listAppliances,
  POST as createAppliance,
} from "@/app/api/consumer-units/[unitId]/appliances/route";
import {
  DELETE as deleteAppliance,
  PATCH as updateAppliance,
} from "@/app/api/consumer-units/[unitId]/appliances/[applianceId]/route";

const TEST_EMAIL_MARKER = "appliances-test";

function jsonRequest(body: unknown, method = "POST", url = "http://localhost") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function unitRouteParams(unitId: string) {
  return { params: Promise.resolve({ unitId }) };
}

function applianceRouteParams(unitId: string, applianceId: string) {
  return { params: Promise.resolve({ unitId, applianceId }) };
}

function asUser(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId } });
}

describe("/api/appliance-catalog and /api/consumer-units/[unitId]/appliances", () => {
  let userAId: string;
  let userBId: string;
  let unitAId: string;
  let unitBId: string;
  let catalogId: string;
  let catalogRoom: string;

  beforeEach(async () => {
    mockAuth.mockReset();
    // Only this file's own users/units are ever removed (cascade deletes take
    // care of their appliances) — never a blanket deleteMany, to avoid
    // stomping on other test files' fixtures under the parallel test pool.
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
        code: "UC-APPL-A",
        distributor: "Test Distribuidora",
        uf: "SP",
        city: "São Paulo",
        tariffGroup: "B",
        tariffSubgroup: "B1",
        tariffModality: "Convencional",
      },
    });
    const unitB = await db.consumerUnit.create({
      data: {
        ownerId: userBId,
        code: "UC-APPL-B",
        distributor: "Test Distribuidora",
        uf: "SP",
        city: "São Paulo",
        tariffGroup: "B",
        tariffSubgroup: "B1",
        tariffModality: "Convencional",
      },
    });
    unitAId = unitA.id;
    unitBId = unitB.id;

    const catalogItem = await db.applianceCatalog.findFirstOrThrow();
    catalogId = catalogItem.id;
    catalogRoom = catalogItem.room;
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_MARKER } },
    });
    await db.$disconnect();
  });

  describe("GET /api/appliance-catalog", () => {
    it("rejects unauthenticated requests", async () => {
      mockAuth.mockResolvedValue(null);
      const response = await getCatalog(new Request("http://localhost"));
      expect(response.status).toBe(401);
    });

    it("returns the seeded catalog", async () => {
      asUser(userAId);
      const response = await getCatalog(new Request("http://localhost"));
      expect(response.status).toBe(200);
      const { catalog } = await response.json();
      expect(catalog.length).toBeGreaterThan(0);
    });

    it("filters by room", async () => {
      asUser(userAId);
      const response = await getCatalog(
        new Request(`http://localhost?room=${catalogRoom}`),
      );
      expect(response.status).toBe(200);
      const { catalog } = await response.json();
      expect(catalog.length).toBeGreaterThan(0);
      expect(catalog.every((item: { room: string }) => item.room === catalogRoom)).toBe(
        true,
      );
    });

    it("rejects an invalid room", async () => {
      asUser(userAId);
      const response = await getCatalog(
        new Request("http://localhost?room=not-a-room"),
      );
      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/consumer-units/[unitId]/appliances", () => {
    it("rejects unauthenticated requests", async () => {
      mockAuth.mockResolvedValue(null);
      const response = await createAppliance(
        jsonRequest({}),
        unitRouteParams(unitAId),
      );
      expect(response.status).toBe(401);
    });

    it("returns 404 for a UC the user does not own", async () => {
      asUser(userBId);
      const response = await createAppliance(
        jsonRequest({
          name: "Geladeira",
          room: "Cozinha",
          powerW: 150,
          usageHoursPerDay: 8,
          usageDaysPerWeek: 7,
          quantity: 1,
          condition: "normal",
          isCustom: false,
        }),
        unitRouteParams(unitAId),
      );
      expect(response.status).toBe(404);
    });

    it("rejects invalid payloads with 400", async () => {
      asUser(userAId);
      const response = await createAppliance(
        jsonRequest({
          name: "Geladeira",
          room: "Cozinha",
          powerW: -10,
          usageHoursPerDay: 8,
          usageDaysPerWeek: 7,
          quantity: 1,
        }),
        unitRouteParams(unitAId),
      );
      expect(response.status).toBe(400);
    });

    it("creates a catalog-based appliance", async () => {
      asUser(userAId);
      const response = await createAppliance(
        jsonRequest({
          catalogId,
          name: "Geladeira",
          room: "Cozinha",
          powerW: 150,
          usageHoursPerDay: 8,
          usageDaysPerWeek: 7,
          quantity: 1,
          condition: "normal",
          isCustom: false,
        }),
        unitRouteParams(unitAId),
      );
      expect(response.status).toBe(201);
      const { appliance } = await response.json();
      expect(appliance.catalogId).toBe(catalogId);
      expect(appliance.consumerUnitId).toBe(unitAId);
    });

    it("creates a custom appliance without a catalogId", async () => {
      asUser(userAId);
      const response = await createAppliance(
        jsonRequest({
          name: "Aparelho exótico",
          room: "Sala",
          powerW: 500,
          usageHoursPerDay: 2,
          usageDaysPerWeek: 5,
          quantity: 1,
          condition: "novo",
          isCustom: true,
        }),
        unitRouteParams(unitAId),
      );
      expect(response.status).toBe(201);
      const { appliance } = await response.json();
      expect(appliance.catalogId).toBeNull();
      expect(appliance.isCustom).toBe(true);
    });

    it("rejects a non-existent catalogId with 400", async () => {
      asUser(userAId);
      const response = await createAppliance(
        jsonRequest({
          catalogId: "does-not-exist",
          name: "Geladeira",
          room: "Cozinha",
          powerW: 150,
          usageHoursPerDay: 8,
          usageDaysPerWeek: 7,
          quantity: 1,
          condition: "normal",
          isCustom: false,
        }),
        unitRouteParams(unitAId),
      );
      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/consumer-units/[unitId]/appliances", () => {
    it("lists only the appliances of the requested UC", async () => {
      asUser(userAId);
      await createAppliance(
        jsonRequest({
          name: "Geladeira",
          room: "Cozinha",
          powerW: 150,
          usageHoursPerDay: 8,
          usageDaysPerWeek: 7,
          quantity: 1,
          isCustom: false,
        }),
        unitRouteParams(unitAId),
      );

      asUser(userBId);
      await createAppliance(
        jsonRequest({
          name: "Freezer",
          room: "Cozinha",
          powerW: 200,
          usageHoursPerDay: 6,
          usageDaysPerWeek: 7,
          quantity: 1,
          isCustom: false,
        }),
        unitRouteParams(unitBId),
      );

      asUser(userAId);
      const response = await listAppliances(
        new Request("http://localhost"),
        unitRouteParams(unitAId),
      );
      expect(response.status).toBe(200);
      const { appliances } = await response.json();
      expect(appliances).toHaveLength(1);
      expect(appliances[0].name).toBe("Geladeira");
    });

    it("returns 404 for a UC the user does not own", async () => {
      asUser(userBId);
      const response = await listAppliances(
        new Request("http://localhost"),
        unitRouteParams(unitAId),
      );
      expect(response.status).toBe(404);
    });
  });

  describe("PATCH and DELETE /api/consumer-units/[unitId]/appliances/[applianceId]", () => {
    async function createTestAppliance() {
      asUser(userAId);
      const response = await createAppliance(
        jsonRequest({
          catalogId,
          name: "Geladeira",
          room: "Cozinha",
          powerW: 150,
          usageHoursPerDay: 8,
          usageDaysPerWeek: 7,
          quantity: 1,
          condition: "normal",
          isCustom: false,
        }),
        unitRouteParams(unitAId),
      );
      const { appliance } = await response.json();
      return appliance as { id: string };
    }

    it("updates an owned appliance", async () => {
      const appliance = await createTestAppliance();

      asUser(userAId);
      const response = await updateAppliance(
        jsonRequest({ quantity: 2, powerW: 160 }, "PATCH"),
        applianceRouteParams(unitAId, appliance.id),
      );
      expect(response.status).toBe(200);
      const { appliance: updated } = await response.json();
      expect(updated.quantity).toBe(2);
      expect(updated.powerW).toBe(160);
    });

    it("prevents a user from updating another user's appliance", async () => {
      const appliance = await createTestAppliance();

      asUser(userBId);
      const response = await updateAppliance(
        jsonRequest({ quantity: 5 }, "PATCH"),
        applianceRouteParams(unitAId, appliance.id),
      );
      expect(response.status).toBe(404);

      const stillOriginal = await db.householdAppliance.findUnique({
        where: { id: appliance.id },
      });
      expect(stillOriginal?.quantity).toBe(1);
    });

    it("returns 404 for a non-existent appliance id", async () => {
      asUser(userAId);
      const response = await updateAppliance(
        jsonRequest({ quantity: 2 }, "PATCH"),
        applianceRouteParams(unitAId, "does-not-exist"),
      );
      expect(response.status).toBe(404);
    });

    it("deletes an owned appliance", async () => {
      const appliance = await createTestAppliance();

      asUser(userAId);
      const response = await deleteAppliance(
        new Request("http://localhost"),
        applianceRouteParams(unitAId, appliance.id),
      );
      expect(response.status).toBe(204);

      const stillExists = await db.householdAppliance.findUnique({
        where: { id: appliance.id },
      });
      expect(stillExists).toBeNull();
    });

    it("prevents a user from deleting another user's appliance", async () => {
      const appliance = await createTestAppliance();

      asUser(userBId);
      const response = await deleteAppliance(
        new Request("http://localhost"),
        applianceRouteParams(unitAId, appliance.id),
      );
      expect(response.status).toBe(404);

      const stillExists = await db.householdAppliance.findUnique({
        where: { id: appliance.id },
      });
      expect(stillExists).not.toBeNull();
    });
  });
});
