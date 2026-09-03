import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  withAuthenticatedDb: vi.fn(),
  createExpenseCategory: vi.fn(),
  updateExpenseCategory: vi.fn(),
  toggleExpenseCategory: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/db", () => ({ withAuthenticatedDb: mocks.withAuthenticatedDb }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/services/expense-category-manager", async () => {
  class ExpenseCategoryDuplicateError extends Error {}
  class ExpenseCategoryNotFoundError extends Error {}

  return {
    ExpenseCategoryDuplicateError,
    ExpenseCategoryNotFoundError,
    createExpenseCategory: mocks.createExpenseCategory,
    updateExpenseCategory: mocks.updateExpenseCategory,
    toggleExpenseCategory: mocks.toggleExpenseCategory,
  };
});

import {
  createExpenseCategoryAction,
  toggleExpenseCategoryAction,
  updateExpenseCategoryAction,
} from "./expense-categories";
import { ExpenseCategoryDuplicateError } from "@/lib/services/expense-category-manager";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const categoryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function categoryFormData() {
  const data = new FormData();
  data.set("name", "  Software  ");
  data.set("icon", "  app-window  ");
  data.set("ownerId", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  return data;
}

describe("expense category actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: ownerId });
    mocks.withAuthenticatedDb.mockImplementation(
      (_ownerId: string, operation: (database: object) => unknown) => operation({}),
    );
    mocks.createExpenseCategory.mockResolvedValue({ id: categoryId });
    mocks.updateExpenseCategory.mockResolvedValue({ id: categoryId });
    mocks.toggleExpenseCategory.mockResolvedValue({ id: categoryId, active: false });
  });

  it("creates a normalized category for only the verified owner", async () => {
    const result = await createExpenseCategoryAction(
      { status: "idle" },
      categoryFormData(),
    );

    expect(result).toEqual({ status: "success", categoryId });
    expect(mocks.createExpenseCategory).toHaveBeenCalledWith({}, {
      ownerId,
      values: { name: "Software", icon: "app-window" },
    });
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledWith(ownerId, expect.any(Function));
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/settings",
      "/expenses",
      "/expenses/new",
    ]);
  });

  it("returns field errors without opening a database scope", async () => {
    const data = categoryFormData();
    data.set("name", "   ");

    const result = await createExpenseCategoryAction({ status: "idle" }, data);

    expect(result).toMatchObject({
      status: "error",
      message: "Revisá los campos indicados.",
      fieldErrors: { name: expect.any(Array) },
    });
    expect(mocks.withAuthenticatedDb).not.toHaveBeenCalled();
  });

  it("maps case-insensitive duplicates to the name field", async () => {
    mocks.createExpenseCategory.mockRejectedValue(new ExpenseCategoryDuplicateError());

    const result = await createExpenseCategoryAction(
      { status: "idle" },
      categoryFormData(),
    );

    expect(result).toEqual({
      status: "error",
      message: "Ya existe una categoría con ese nombre.",
      fieldErrors: { name: ["Usá un nombre diferente."] },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("renames an owned category and revalidates targeted paths", async () => {
    const data = categoryFormData();
    data.set("categoryId", categoryId);

    await expect(updateExpenseCategoryAction({ status: "idle" }, data))
      .resolves.toEqual({ status: "success", categoryId });
    expect(mocks.updateExpenseCategory).toHaveBeenCalledWith({}, {
      categoryId,
      ownerId,
      values: { name: "Software", icon: "app-window" },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(3);
  });

  it("deactivates or restores without accepting an owner from form data", async () => {
    const data = new FormData();
    data.set("categoryId", categoryId);
    data.set("active", "false");
    data.set("ownerId", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");

    await expect(toggleExpenseCategoryAction({ status: "idle" }, data))
      .resolves.toEqual({ status: "success", categoryId, active: false });
    expect(mocks.toggleExpenseCategory).toHaveBeenCalledWith({}, {
      categoryId,
      ownerId,
      active: false,
    });
  });
});
