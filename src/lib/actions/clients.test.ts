import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  withAuthenticatedDb: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/db", () => ({ withAuthenticatedDb: mocks.withAuthenticatedDb }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  archiveClientAction,
  createClientAction,
  updateClientAction,
} from "./clients";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function validFormData() {
  const data = new FormData();
  data.set("firstName", " Agustín ");
  data.set("lastName", " Pérez ");
  data.set("email", "AGUSTIN@EXAMPLE.COM");
  data.set("status", "active");
  data.set("ownerId", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  return data;
}

describe("client actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: userId });
  });

  it("creates a client using only the verified owner id", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: clientId }]);
    const values = vi.fn(() => ({ returning }));
    const insert = vi.fn(() => ({ values }));
    mocks.withAuthenticatedDb.mockImplementation(
      (_id: string, operation: (db: unknown) => unknown) => operation({ insert }),
    );

    const result = await createClientAction({ status: "idle" }, validFormData());

    expect(result).toEqual({ status: "success", clientId });
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledWith(
      userId,
      expect.any(Function),
    );
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: userId,
        firstName: "Agustín",
        lastName: "Pérez",
        email: "agustin@example.com",
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/clients");
  });

  it("returns bounded field errors without opening the database", async () => {
    const data = validFormData();
    data.set("firstName", " ");

    const result = await createClientAction({ status: "idle" }, data);

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.firstName).toBeDefined();
    expect(result.message).toBe("Revisá los campos indicados.");
    expect(mocks.withAuthenticatedDb).not.toHaveBeenCalled();
  });

  it("updates only an owned client and returns a generic missing message", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    mocks.withAuthenticatedDb.mockImplementation(
      (_id: string, operation: (db: unknown) => unknown) => operation({ update }),
    );
    const data = validFormData();
    data.set("id", clientId);

    const result = await updateClientAction({ status: "idle" }, data);

    expect(result).toEqual({
      status: "error",
      message: "No pudimos actualizar el cliente.",
    });
  });

  it("archives instead of deleting", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: clientId }]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    mocks.withAuthenticatedDb.mockImplementation(
      (_id: string, operation: (db: unknown) => unknown) => operation({ update }),
    );
    const data = new FormData();
    data.set("id", clientId);

    const result = await archiveClientAction({ status: "idle" }, data);

    expect(result).toEqual({ status: "success", clientId });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "archived" }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/clients");
  });
});
