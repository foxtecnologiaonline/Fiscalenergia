// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";

const { mockSendEmail } = vi.hoisted(() => ({ mockSendEmail: vi.fn() }));

vi.mock("@/lib/email", () => ({
  sendEmail: mockSendEmail,
}));

import {
  notifyBillProcessed,
  notifyHighSeverityFindings,
  notifySuggestionsEvaluated,
} from "@/lib/notifications";

const TEST_EMAIL_MARKER = "notifications-test";
const TEST_DISTRIBUTOR = "Test Distribuidora Notificações";
const MONTH_1 = new Date("2033-01-01T00:00:00.000Z");

describe("lib/notifications", () => {
  let unitId: string;
  let userId: string;
  let userEmail: string;

  beforeEach(async () => {
    mockSendEmail.mockReset();
    mockSendEmail.mockResolvedValue(undefined);

    await db.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_MARKER } },
    });

    userEmail = `user-${Date.now()}@${TEST_EMAIL_MARKER}.com`;
    const user = await db.user.create({
      data: { email: userEmail, passwordHash: "hash" },
    });
    userId = user.id;

    const unit = await db.consumerUnit.create({
      data: {
        ownerId: userId,
        code: "UC-NOTIF-1",
        distributor: TEST_DISTRIBUTOR,
        uf: "SP",
        city: "São Paulo",
        tariffGroup: "B",
        tariffSubgroup: "B1",
        tariffModality: "Convencional",
      },
    });
    unitId = unit.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_MARKER } },
    });
    await db.$disconnect();
  });

  async function createBill(overrides: Partial<{ status: "done" | "error"; errorMessage: string | null }> = {}) {
    return db.bill.create({
      data: {
        consumerUnitId: unitId,
        referenceMonth: MONTH_1,
        fileUrl: "https://blob.example.com/fake.pdf",
        status: overrides.status ?? "done",
        errorMessage: overrides.errorMessage ?? null,
      },
    });
  }

  describe("notifyBillProcessed", () => {
    it("sends an email and records a Notification for a successfully processed bill", async () => {
      const bill = await createBill({ status: "done" });

      await notifyBillProcessed(bill);

      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: userEmail }),
      );
      const notifications = await db.notification.findMany({
        where: { userId, billId: bill.id },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].message).toContain("processada com sucesso");
    });

    it("records an error message for a bill that failed processing", async () => {
      const bill = await createBill({
        status: "error",
        errorMessage: "Falha na extração",
      });

      await notifyBillProcessed(bill);

      const notifications = await db.notification.findMany({
        where: { userId, billId: bill.id },
      });
      expect(notifications[0].message).toContain("Falha na extração");
    });

    it("does not send or record anything when the user disabled email notifications", async () => {
      await db.user.update({
        where: { id: userId },
        data: { emailNotificationsEnabled: false },
      });
      const bill = await createBill({ status: "done" });

      await notifyBillProcessed(bill);

      expect(mockSendEmail).not.toHaveBeenCalled();
      const notifications = await db.notification.findMany({
        where: { userId, billId: bill.id },
      });
      expect(notifications).toEqual([]);
    });
  });

  describe("notifyHighSeverityFindings", () => {
    it("does nothing when there are no high-severity findings", async () => {
      const bill = await createBill();
      await notifyHighSeverityFindings(
        [
          {
            id: "f1",
            consumerUnitId: unitId,
            billId: bill.id,
            type: "billing_error",
            ruleCode: "billing.kwh_rate_mismatch",
            severity: "medium",
            description: "desc",
            estimatedImpactAmount: null,
            createdAt: new Date(),
          },
        ],
        bill,
      );
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("sends one notification listing all high-severity findings", async () => {
      const bill = await createBill();
      await notifyHighSeverityFindings(
        [
          {
            id: "f1",
            consumerUnitId: unitId,
            billId: bill.id,
            type: "billing_error",
            ruleCode: "billing.kwh_rate_mismatch",
            severity: "high",
            description: "Tarifa muito divergente.",
            estimatedImpactAmount: 100,
            createdAt: new Date(),
          },
          {
            id: "f2",
            consumerUnitId: unitId,
            billId: null,
            type: "possible_waste_or_loss",
            ruleCode: "waste.unexplained_consumption_jump",
            severity: "high",
            description: "Salto de consumo.",
            estimatedImpactAmount: null,
            createdAt: new Date(),
          },
        ],
        bill,
      );

      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      const notifications = await db.notification.findMany({
        where: { userId, billId: bill.id },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].message).toContain("2 achado(s)");
      expect(notifications[0].message).toContain("Tarifa muito divergente.");
      expect(notifications[0].message).toContain("Salto de consumo.");
    });
  });

  describe("notifySuggestionsEvaluated", () => {
    it("does nothing for an empty list", async () => {
      const bill = await createBill();
      await notifySuggestionsEvaluated([], bill);
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("sends one notification listing evaluated suggestions", async () => {
      const bill = await createBill();
      await notifySuggestionsEvaluated(
        [
          {
            id: "s1",
            consumerUnitId: unitId,
            findingId: null,
            householdApplianceId: null,
            ruleCode: "billing.kwh_rate_mismatch",
            title: "Contestar tarifa de kWh cobrada incorretamente",
            description: "desc",
            estimatedSavingsKwh: null,
            estimatedSavingsAmount: 30,
            status: "applied",
            appliedAt: new Date(),
            appliedNote: "nota",
            baselineBillId: null,
            followUpBillId: bill.id,
            actualSavingsKwh: null,
            actualSavingsAmount: 25,
            evaluatedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        bill,
      );

      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      const notifications = await db.notification.findMany({
        where: { userId, billId: bill.id },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].message).toContain(
        "Contestar tarifa de kWh cobrada incorretamente",
      );
    });
  });
});
