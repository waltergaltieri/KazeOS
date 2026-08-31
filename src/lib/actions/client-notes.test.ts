import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), withAuthenticatedDb: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/db", () => ({ withAuthenticatedDb: mocks.withAuthenticatedDb }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { createClientNoteAction, deleteClientNoteAction, updateClientNoteAction } from "./client-notes";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const noteId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("client note actions", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireUser.mockResolvedValue({ id: ownerId }); });

  it("creates a trimmed note only in the verified owner scope", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: noteId, clientId }]);
    const values = vi.fn(() => ({ returning }));
    mocks.withAuthenticatedDb.mockImplementation((_id: string, operation: (db: object) => unknown) => operation({ insert: vi.fn(() => ({ values })) }));
    const form = new FormData(); form.set("clientId", clientId); form.set("content", "  Llamar mañana  ");
    await expect(createClientNoteAction({ status: "idle" }, form)).resolves.toMatchObject({ status: "success", noteId, clientId });
    expect(values).toHaveBeenCalledWith({ ownerId, clientId, content: "Llamar mañana" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/clients/${clientId}/notes`);
  });

  it("rejects a blank update before opening a database scope", async () => {
    const form = new FormData(); form.set("noteId", noteId); form.set("clientId", clientId); form.set("content", " ");
    const result = await updateClientNoteAction({ status: "idle" }, form);
    expect(result).toMatchObject({ status: "error", fieldErrors: { content: expect.any(Array) } });
    expect(mocks.withAuthenticatedDb).not.toHaveBeenCalled();
  });

  it("deletes only an owner-scoped note and returns its real client", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: noteId, clientId }]);
    const where = vi.fn(() => ({ returning }));
    mocks.withAuthenticatedDb.mockImplementation((_id: string, operation: (db: object) => unknown) => operation({ delete: vi.fn(() => ({ where })) }));
    const form = new FormData(); form.set("noteId", noteId);
    await expect(deleteClientNoteAction({ status: "idle" }, form)).resolves.toMatchObject({ status: "success", noteId, clientId });
  });
});
