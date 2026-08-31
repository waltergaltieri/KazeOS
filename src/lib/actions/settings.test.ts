import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), withAuthenticatedDb: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/db", () => ({ withAuthenticatedDb: mocks.withAuthenticatedDb }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { updateBusinessSettingsAction, updateProfileSettingsAction } from "./settings";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
describe("settings actions", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireUser.mockResolvedValue({ id: ownerId, email: "authoritative@example.com" }); });
  it("upserts the profile snapshot from verified auth data", async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    mocks.withAuthenticatedDb.mockImplementation((_id: string, operation: (db: object) => unknown) => operation({ insert: vi.fn(() => ({ values })) }));
    const form = new FormData(); form.set("fullName", "  Agustín  "); form.set("email", "forged@example.com");
    await expect(updateProfileSettingsAction({ status: "idle" }, form)).resolves.toMatchObject({ status: "success" });
    expect(values).toHaveBeenCalledWith({ id: ownerId, fullName: "Agustín", email: "authoritative@example.com" });
  });
  it("rejects unsupported business region before DB access", async () => {
    const form = new FormData(); form.set("primaryCurrency", "EUR"); form.set("timezone", "Mars/Olympus"); form.set("locale", "xx-ZZ");
    const result = await updateBusinessSettingsAction({ status: "idle" }, form);
    expect(result).toMatchObject({ status: "error", fieldErrors: expect.objectContaining({ primaryCurrency: expect.any(Array), timezone: expect.any(Array), locale: expect.any(Array) }) });
    expect(mocks.withAuthenticatedDb).not.toHaveBeenCalled();
  });
});
