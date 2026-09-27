// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";

const { mockDownloadBillFile, mockExtractBillData } = vi.hoisted(() => ({
  mockDownloadBillFile: vi.fn(),
  mockExtractBillData: vi.fn(),
}));

vi.mock("@/lib/blob", () => ({
  downloadBillFile: mockDownloadBillFile,
}));

vi.mock("@/lib/claude", () => ({
  extractBillData: mockExtractBillData,
}));

import { processBill } from "@/lib/process-bill";

const TEST_EMAIL_MARKER = "process-bill-test";

const extracted = {
  totalAmount: 452.31,
  consumptionKwh: 320,
  tariffFlag: "amarela" as const,
  previousReadingKwh: 1200,
  currentReadingKwh: 1520,
  billingDays: 30,
  appliedKwhRate: 0.98,
  lineItems: [
    { description: "Consumo TE", quantity: 320, unitRate: 0.98, amount: 313.6 },
  ],
};

describe("processBill", () => {
  let unitId: string;

  beforeEach(async () => {
    mockDownloadBillFile.mockReset();
    mockExtractBillData.mockReset();
    mockDownloadBillFile.mockResolvedValue({
      buffer: Buffer.from("fake-pdf-bytes"),
      contentType: "application/pdf",
    });
    mockExtractBillData.mockResolvedValue(extracted);

    // Scoped to this file's own users (cascades to their units/bills) so
    // parallel test files never wipe each other's fixtures.
    await db.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_MARKER } },
    });

    const user = await db.user.create({
      data: {
        email: `user-${Date.now()}@${TEST_EMAIL_MARKER}.com`,
        passwordHash: "hash",
      },
    });
    const unit = await db.consumerUnit.create({
      data: {
        ownerId: user.id,
        code: "UC-PROCESS-1",
        distributor: "Enel",
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

  async function createPendingBill() {
    return db.bill.create({
      data: {
        consumerUnitId: unitId,
        referenceMonth: new Date("2026-03-01T00:00:00.000Z"),
        fileUrl: "https://blob.example.com/fake-bill",
        status: "pending",
      },
    });
  }

  it("downloads, extracts and saves the bill as done", async () => {
    const bill = await createPendingBill();

    const result = await processBill(bill.id);

    expect(result?.status).toBe("done");
    expect(result?.totalAmount).toBe(452.31);
    expect(result?.tariffFlag).toBe("amarela");
    expect(result?.errorMessage).toBeNull();
    expect(result?.lineItems).toEqual(extracted.lineItems);
    expect(result?.extractedData).toEqual(extracted);
    expect(mockDownloadBillFile).toHaveBeenCalledWith(bill.fileUrl);
    expect(mockExtractBillData).toHaveBeenCalledWith(
      Buffer.from("fake-pdf-bytes"),
      "application/pdf",
    );
  });

  it("marks the bill as error when extraction throws", async () => {
    const bill = await createPendingBill();
    mockExtractBillData.mockRejectedValue(new Error("Claude timed out"));

    const result = await processBill(bill.id);

    expect(result?.status).toBe("error");
    expect(result?.errorMessage).toBe("Claude timed out");
    expect(result?.totalAmount).toBeNull();
  });

  it("marks the bill as error when the download fails", async () => {
    const bill = await createPendingBill();
    mockDownloadBillFile.mockRejectedValue(new Error("blob not found"));

    const result = await processBill(bill.id);

    expect(result?.status).toBe("error");
    expect(result?.errorMessage).toBe("blob not found");
    expect(mockExtractBillData).not.toHaveBeenCalled();
  });

  it("marks the bill as error when the stored file type is unsupported", async () => {
    const bill = await createPendingBill();
    mockDownloadBillFile.mockResolvedValue({
      buffer: Buffer.from("data"),
      contentType: "text/plain",
    });

    const result = await processBill(bill.id);

    expect(result?.status).toBe("error");
    expect(result?.errorMessage).toMatch(/não suportado/);
    expect(mockExtractBillData).not.toHaveBeenCalled();
  });

  it("is a no-op when the bill is not pending", async () => {
    const bill = await createPendingBill();
    await db.bill.update({ where: { id: bill.id }, data: { status: "done" } });

    const result = await processBill(bill.id);

    expect(result).toBeNull();
    expect(mockDownloadBillFile).not.toHaveBeenCalled();
    expect(mockExtractBillData).not.toHaveBeenCalled();
  });

  it("only lets one of two concurrent calls proceed", async () => {
    const bill = await createPendingBill();

    const [first, second] = await Promise.all([
      processBill(bill.id),
      processBill(bill.id),
    ]);

    const results = [first, second];
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(mockExtractBillData).toHaveBeenCalledTimes(1);
  });
});
