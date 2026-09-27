// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { MAX_BILL_FILE_SIZE_BYTES } from "@/lib/validations/bill";

const { mockAuth, mockUploadBillFile } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockUploadBillFile: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/blob", () => ({
  uploadBillFile: mockUploadBillFile,
}));

import { POST as createBill } from "@/app/api/bills/route";

const TEST_EMAIL_MARKER = "bills-test";

function asUser(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId } });
}

function pdfFile(name = "fatura.pdf", size = 1024) {
  return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

function billFormData(overrides: {
  consumerUnitId?: string;
  referenceMonth?: string;
  file?: File | null;
}) {
  const formData = new FormData();
  if (overrides.consumerUnitId !== undefined) {
    formData.set("consumerUnitId", overrides.consumerUnitId);
  }
  if (overrides.referenceMonth !== undefined) {
    formData.set("referenceMonth", overrides.referenceMonth);
  }
  if (overrides.file !== undefined && overrides.file !== null) {
    formData.set("file", overrides.file);
  }
  return new Request("http://localhost/api/bills", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/bills", () => {
  let userAId: string;
  let userBId: string;
  let unitAId: string;

  beforeEach(async () => {
    mockAuth.mockReset();
    mockUploadBillFile.mockReset();
    mockUploadBillFile.mockResolvedValue(
      "https://blob.example.com/fake-bill-url",
    );

    await db.bill.deleteMany({});
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

    const unitA = await db.consumerUnit.create({
      data: {
        ownerId: userAId,
        code: "UC-BILLS-1",
        distributor: "Enel",
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
    await db.bill.deleteMany({});
    await db.consumerUnit.deleteMany({});
    await db.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_MARKER } },
    });
    await db.$disconnect();
  });

  it("rejects unauthenticated requests", async () => {
    mockAuth.mockResolvedValue(null);
    const response = await createBill(
      billFormData({
        consumerUnitId: unitAId,
        referenceMonth: "2026-03",
        file: pdfFile(),
      }),
    );
    expect(response.status).toBe(401);
    expect(mockUploadBillFile).not.toHaveBeenCalled();
  });

  it("rejects an invalid referenceMonth", async () => {
    asUser(userAId);
    const response = await createBill(
      billFormData({
        consumerUnitId: unitAId,
        referenceMonth: "2026-3",
        file: pdfFile(),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a missing file", async () => {
    asUser(userAId);
    const response = await createBill(
      billFormData({ consumerUnitId: unitAId, referenceMonth: "2026-03" }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects an unsupported file type", async () => {
    asUser(userAId);
    const textFile = new File(["hello"], "notes.txt", {
      type: "text/plain",
    });
    const response = await createBill(
      billFormData({
        consumerUnitId: unitAId,
        referenceMonth: "2026-03",
        file: textFile,
      }),
    );
    expect(response.status).toBe(400);
    expect(mockUploadBillFile).not.toHaveBeenCalled();
  });

  it("rejects a file larger than 20MB", async () => {
    asUser(userAId);
    const oversized = pdfFile("big.pdf", MAX_BILL_FILE_SIZE_BYTES + 1);
    const response = await createBill(
      billFormData({
        consumerUnitId: unitAId,
        referenceMonth: "2026-03",
        file: oversized,
      }),
    );
    expect(response.status).toBe(400);
    expect(mockUploadBillFile).not.toHaveBeenCalled();
  });

  it("rejects uploading to a UC that does not belong to the user", async () => {
    asUser(userBId);
    const response = await createBill(
      billFormData({
        consumerUnitId: unitAId,
        referenceMonth: "2026-03",
        file: pdfFile(),
      }),
    );
    expect(response.status).toBe(404);
    expect(mockUploadBillFile).not.toHaveBeenCalled();
  });

  it("rejects uploading to a non-existent UC", async () => {
    asUser(userAId);
    const response = await createBill(
      billFormData({
        consumerUnitId: "does-not-exist",
        referenceMonth: "2026-03",
        file: pdfFile(),
      }),
    );
    expect(response.status).toBe(404);
  });

  it("creates a pending bill with the reference month normalized to the 1st, in UTC", async () => {
    asUser(userAId);
    const response = await createBill(
      billFormData({
        consumerUnitId: unitAId,
        referenceMonth: "2026-03",
        file: pdfFile(),
      }),
    );

    expect(response.status).toBe(201);
    const { bill } = await response.json();
    expect(bill.status).toBe("pending");
    expect(bill.fileUrl).toBe("https://blob.example.com/fake-bill-url");
    expect(bill.referenceMonth).toBe("2026-03-01T00:00:00.000Z");
    expect(mockUploadBillFile).toHaveBeenCalledTimes(1);
    expect(mockUploadBillFile).toHaveBeenCalledWith(
      unitAId,
      expect.any(File),
    );

    const stored = await db.bill.findUnique({ where: { id: bill.id } });
    expect(stored?.consumerUnitId).toBe(unitAId);
  });

  it("returns 502 when the blob upload fails", async () => {
    asUser(userAId);
    mockUploadBillFile.mockRejectedValue(new Error("blob service unavailable"));

    const response = await createBill(
      billFormData({
        consumerUnitId: unitAId,
        referenceMonth: "2026-03",
        file: pdfFile(),
      }),
    );

    expect(response.status).toBe(502);
    const stored = await db.bill.findMany({ where: { consumerUnitId: unitAId } });
    expect(stored).toHaveLength(0);
  });

  it("accepts JPG and PNG files", async () => {
    asUser(userAId);
    const jpg = new File([new Uint8Array(10)], "fatura.jpg", {
      type: "image/jpeg",
    });
    const response = await createBill(
      billFormData({
        consumerUnitId: unitAId,
        referenceMonth: "2026-04",
        file: jpg,
      }),
    );
    expect(response.status).toBe(201);
  });
});
