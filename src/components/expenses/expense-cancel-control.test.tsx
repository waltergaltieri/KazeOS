import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  delete: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/actions/expenses", () => ({
  cancelExpenseAction: mocks.cancel,
  deleteExpenseAction: mocks.delete,
}));

import { ExpenseCancelControl } from "./expense-cancel-control";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("ExpenseCancelControl", () => {
  beforeEach(() => vi.clearAllMocks());

  it("moves focus into confirmation and restores the exact opener on return", async () => {
    const user = userEvent.setup();
    render(<ExpenseCancelControl expenseId="11111111-1111-4111-8111-111111111111" title="Servidor" allowDelete />);

    const opener = screen.getByRole("button", { name: "Cancelar gasto Servidor" });
    await user.click(opener);
    expect(screen.getByRole("button", { name: "Confirmar cancelación" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Volver" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("returns focus and preserves feedback when cancellation fails", async () => {
    const user = userEvent.setup();
    mocks.cancel.mockResolvedValue({ status: "error", message: "No se pudo cancelar." });
    render(<ExpenseCancelControl expenseId="11111111-1111-4111-8111-111111111111" title="Servidor" allowDelete />);

    const opener = screen.getByRole("button", { name: "Cancelar gasto Servidor" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Confirmar cancelación" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cancelar.");
    await waitFor(() => expect(opener).toHaveFocus());
    expect(mocks.refresh).not.toHaveBeenCalled();

    await user.click(opener);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables confirmation while pending, then restores focus and refreshes on success", async () => {
    const user = userEvent.setup();
    const result = deferred<{ status: "success"; expenseId: string }>();
    mocks.delete.mockReturnValue(result.promise);
    render(<ExpenseCancelControl expenseId="11111111-1111-4111-8111-111111111111" title="Servidor" allowDelete />);

    const opener = screen.getByRole("button", { name: "Eliminar gasto Servidor" });
    await user.click(opener);
    const confirmation = screen.getByRole("button", { name: "Confirmar eliminación" });
    await user.click(confirmation);
    expect(confirmation).toBeDisabled();

    await act(async () => result.resolve({ status: "success", expenseId: "11111111-1111-4111-8111-111111111111" }));
    await waitFor(() => expect(opener).toHaveFocus());
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
