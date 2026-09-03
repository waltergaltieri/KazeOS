import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  withAuthenticatedDb: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/db", () => ({ withAuthenticatedDb: mocks.withAuthenticatedDb }));

import { DEFAULT_EXPENSE_CATEGORIES } from "@/lib/constants/default-expense-categories";
import { getExpenseCategories } from "./expense-categories";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function categoryDatabase(rows: Array<{
  id: string;
  name: string;
  icon: string | null;
  active: boolean;
}>) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return { database: { select }, orderBy, where };
}

describe("expense category queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: ownerId });
  });

  it("returns active categories alphabetized for new expense forms", async () => {
    const rows = [
      { id: "11111111-1111-4111-8111-111111111111", name: "Comida", icon: null, active: true },
      { id: "22222222-2222-4222-8222-222222222222", name: "Software", icon: "app", active: true },
    ];
    const fake = categoryDatabase(rows);
    mocks.withAuthenticatedDb.mockImplementation(
      (_ownerId: string, operation: (database: unknown) => unknown) =>
        operation(fake.database),
    );

    await expect(getExpenseCategories()).resolves.toEqual(rows);
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledWith(
      ownerId,
      expect.any(Function),
    );
    expect(fake.where).toHaveBeenCalledOnce();
    expect(fake.orderBy).toHaveBeenCalled();
  });

  it("can include inactive categories for settings and historical editing", async () => {
    const rows = [
      { id: "11111111-1111-4111-8111-111111111111", name: "Comida", icon: null, active: true },
      { id: "33333333-3333-4333-8333-333333333333", name: "Legado", icon: null, active: false },
    ];
    const fake = categoryDatabase(rows);
    mocks.withAuthenticatedDb.mockImplementation(
      (_ownerId: string, operation: (database: unknown) => unknown) =>
        operation(fake.database),
    );

    await expect(getExpenseCategories({ includeInactive: true })).resolves.toEqual(rows);
    expect(fake.where).toHaveBeenCalledOnce();
  });

  it("keeps the sixteen approved defaults unique and stable", () => {
    expect(DEFAULT_EXPENSE_CATEGORIES).toEqual([
      "Servicios", "Software", "Comida", "Transporte", "Ropa",
      "Equipamiento", "Hogar", "Salud", "Educación", "Entretenimiento",
      "Impuestos", "Marketing", "Viajes", "Suscripciones", "Honorarios", "Otros",
    ]);
    expect(new Set(DEFAULT_EXPENSE_CATEGORIES.map((name) => name.toLocaleLowerCase("es-AR"))).size)
      .toBe(16);
  });
});
