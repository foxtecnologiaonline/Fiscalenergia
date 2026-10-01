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
    const EPOCH = new Date(0);

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
        EPOCH,
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
        EPOCH,
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

    it("always notifies for a bill-scoped finding, even if an old matching Suggestion predates sinceDate", async () => {
      const bill = await createBill();
      // Achados com billId != null (fatura/leitura) nunca são recriados —
      // são sempre um fato novo desta fatura específica, então notificam
      // mesmo que, por coincidência, exista uma Suggestion antiga com o
      // mesmo ruleCode+title de um ciclo anterior.
      await db.suggestion.create({
        data: {
          consumerUnitId: unitId,
          ruleCode: "billing.kwh_rate_mismatch",
          title: "Contestar tarifa de kWh cobrada incorretamente",
          description: "desc antiga",
        },
      });
      const sinceDate = new Date(Date.now() + 60_000); // no futuro -> suggestion é "antiga"

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
        ],
        bill,
        sinceDate,
      );

      expect(mockSendEmail).toHaveBeenCalledTimes(1);
    });

    it("skips a recurring appliance-derived finding whose Suggestion already existed before this run", async () => {
      const bill = await createBill();
      const sinceDate = new Date();
      // Simula uma Suggestion já upsertada em um ciclo ANTERIOR (createdAt
      // no passado, antes de sinceDate).
      await db.suggestion.create({
        data: {
          consumerUnitId: unitId,
          ruleCode: "appliance.outdated_or_unmaintained",
          title: "Agendar manutenção ou considerar substituição do aparelho — Geladeira (Cozinha)",
          description: "Geladeira (Cozinha): aparelho antigo...",
          createdAt: new Date(sinceDate.getTime() - 60_000),
        },
      });

      await notifyHighSeverityFindings(
        [
          {
            id: "f1",
            consumerUnitId: unitId,
            billId: null,
            type: "appliance_inefficiency",
            ruleCode: "appliance.outdated_or_unmaintained",
            severity: "high",
            description: "Geladeira (Cozinha): aparelho antigo...",
            estimatedImpactAmount: null,
            createdAt: new Date(),
          },
        ],
        bill,
        sinceDate,
      );

      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("notifies for an appliance-derived finding whose Suggestion was just created in this run", async () => {
      const bill = await createBill();
      const sinceDate = new Date();
      await db.suggestion.create({
        data: {
          consumerUnitId: unitId,
          ruleCode: "appliance.outdated_or_unmaintained",
          title: "Agendar manutenção ou considerar substituição do aparelho — Geladeira (Cozinha)",
          description: "Geladeira (Cozinha): aparelho antigo...",
          createdAt: new Date(sinceDate.getTime() + 1000),
        },
      });

      await notifyHighSeverityFindings(
        [
          {
            id: "f1",
            consumerUnitId: unitId,
            billId: null,
            type: "appliance_inefficiency",
            ruleCode: "appliance.outdated_or_unmaintained",
            severity: "high",
            description: "Geladeira (Cozinha): aparelho antigo...",
            estimatedImpactAmount: null,
            createdAt: new Date(),
          },
        ],
        bill,
        sinceDate,
      );

      expect(mockSendEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe("HTML escaping", () => {
    it("escapes HTML-significant characters from free-form text before building the email body", async () => {
      const bill = await createBill({
        status: "error",
        errorMessage: '<b onmouseover="x">Falha & "erro" <script>',
      });

      await notifyBillProcessed(bill);

      const html = mockSendEmail.mock.calls.at(-1)?.[0]?.html as string;
      expect(html).not.toContain("<b onmouseover");
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;b onmouseover=&quot;x&quot;&gt;");
      expect(html).toContain("Falha &amp; &quot;erro&quot;");

      // O texto original (não escapado) continua sendo o que fica
      // guardado no banco — React já escapa ao renderizar na UI.
      const notifications = await db.notification.findMany({
        where: { userId, billId: bill.id },
      });
      expect(notifications[0].message).toContain('<b onmouseover="x">');
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
