import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

import { PATCH as updateEmailPreferences } from "@/app/api/account/email-preferences/route";

const TEST_EMAIL_MARKER = "account-email-prefs-test";

function jsonRequest(body: unknown) {
  return new Request("http://localhost", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function asUser(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId } });
}

describe("PATCH /api/account/email-preferences", () => {
  let userId: string;

  beforeEach(async () => {
    mockAuth.mockReset();
    await db.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_MARKER } },
    });

    const user = await db.user.create({
      data: {
        email: `user-${Date.now()}@${TEST_EMAIL_MARKER}.com`,
        passwordHash: "hash",
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_MARKER } },
    });
    await db.$disconnect();
  });

  it("rejects unauthenticated requests", async () => {
    mockAuth.mockResolvedValue(null);
    const response = await updateEmailPreferences(
      jsonRequest({ emailNotificationsEnabled: false }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects an invalid payload", async () => {
    asUser(userId);
    const response = await updateEmailPreferences(
      jsonRequest({ emailNotificationsEnabled: "not-a-boolean" }),
    );
    expect(response.status).toBe(400);
  });

  it("disables and re-enables email notifications for the authenticated user", async () => {
    asUser(userId);

    const disableResponse = await updateEmailPreferences(
      jsonRequest({ emailNotificationsEnabled: false }),
    );
    expect(disableResponse.status).toBe(200);
    const { user: disabled } = await disableResponse.json();
    expect(disabled.emailNotificationsEnabled).toBe(false);

    const stored = await db.user.findUnique({ where: { id: userId } });
    expect(stored?.emailNotificationsEnabled).toBe(false);

    const enableResponse = await updateEmailPreferences(
      jsonRequest({ emailNotificationsEnabled: true }),
    );
    const { user: enabled } = await enableResponse.json();
    expect(enabled.emailNotificationsEnabled).toBe(true);
  });
});
