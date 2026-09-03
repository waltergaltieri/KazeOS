import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import { ExpenseForm, type ExpenseFormDefaults } from "./expense-form";

const category = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Servicios",
  icon: null,
  active: true,
};

const defaults: ExpenseFormDefaults = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  title: "Internet",
  amountMinor: 45_000_00,
  currency: "ARS",
  categoryId: category.id,
  scope: "business",
  costType: "fixed",
  dueDate: "2026-09-15",
  status: "pending",
};

describe("ExpenseForm navigation", () => {
  beforeEach(() => router.replace.mockReset());

  it("keeps the submitted action state when refreshed defaults belong to the same expense", async () => {
    let resolveAction!: (state: { status: "success"; expenseId: string }) => void;
    const action = vi.fn().mockImplementation(
      () => new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    const user = userEvent.setup();
    const { rerender } = render(
      <ExpenseForm
        oneOffAction={action}
        categories={[category]}
        mode="edit"
        defaults={defaults}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());

    rerender(
      <ExpenseForm
        oneOffAction={action}
        categories={[category]}
        mode="edit"
        defaults={{ ...defaults, title: "Internet actualizado", amountMinor: 50_000_00 }}
      />,
    );
    resolveAction({ status: "success", expenseId: defaults.id! });

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/expenses"));
  });
});
