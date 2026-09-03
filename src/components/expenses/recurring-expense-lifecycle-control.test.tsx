import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  pause: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/actions/recurring-expenses", () => ({
  cancelRecurringExpenseAction: mocks.cancel,
  pauseRecurringExpenseAction: mocks.pause,
}));

import { RecurringExpenseLifecycleControl } from "./recurring-expense-lifecycle-control";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function simulateBrowserFocusRules(element: HTMLElement) {
  const nativeFocus = HTMLElement.prototype.focus;
  const focusWhileVisible: boolean[] = [];
  vi.spyOn(element, "focus").mockImplementation(() => {
    const visible = element.isConnected && element.closest("[hidden]") === null;
    focusWhileVisible.push(visible);
    if (visible) nativeFocus.call(element);
  });
  return focusWhileVisible;
}

const props = {
  recurringExpenseId: "11111111-1111-4111-8111-111111111111",
  title: "Coworking",
} as const;

describe("RecurringExpenseLifecycleControl", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers only valid lifecycle actions for each status", () => {
    const { rerender } = render(<RecurringExpenseLifecycleControl {...props} status="active" />);

    expect(screen.getByRole("button", { name: "Pausar recurrencia Coworking" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancelar recurrencia Coworking" })).toBeVisible();

    rerender(<RecurringExpenseLifecycleControl {...props} status="paused" />);
    expect(screen.queryByRole("button", { name: "Pausar recurrencia Coworking" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar recurrencia Coworking" })).toBeVisible();

    rerender(<RecurringExpenseLifecycleControl {...props} status="cancelled" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("requires explicit cancellation confirmation and restores focus on return", async () => {
    const user = userEvent.setup();
    render(<RecurringExpenseLifecycleControl {...props} status="active" />);

    const opener = screen.getByRole("button", { name: "Cancelar recurrencia Coworking" });
    const focusWhileVisible = simulateBrowserFocusRules(opener);
    await user.click(opener);
    focusWhileVisible.length = 0;

    expect(screen.getByRole("group", { name: "Confirmar cancelación de Coworking" })).toHaveTextContent(
      "La cancelación es definitiva. Conserva el historial y detiene futuras proyecciones.",
    );
    expect(screen.getByRole("button", { name: "Confirmar cancelación" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Volver" }));
    await waitFor(() => expect(opener).toHaveFocus());
    expect(focusWhileVisible).toEqual([true]);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("announces pause pending and success states, then refreshes", async () => {
    const user = userEvent.setup();
    const result = deferred<{ status: "success"; recurringExpenseId: string }>();
    mocks.pause.mockReturnValue(result.promise);
    render(<RecurringExpenseLifecycleControl {...props} status="active" />);

    const pause = screen.getByRole("button", { name: "Pausar recurrencia Coworking" });
    await user.click(pause);

    expect(pause).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Pausando recurrencia…");

    await act(async () => result.resolve({ status: "success", recurringExpenseId: props.recurringExpenseId }));
    expect(await screen.findByRole("status")).toHaveTextContent("Recurrencia pausada.");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("announces cancellation errors and restores the opener", async () => {
    const user = userEvent.setup();
    mocks.cancel.mockResolvedValue({ status: "error", message: "No se pudo cancelar." });
    render(<RecurringExpenseLifecycleControl {...props} status="paused" />);

    const opener = screen.getByRole("button", { name: "Cancelar recurrencia Coworking" });
    const focusWhileVisible = simulateBrowserFocusRules(opener);
    await user.click(opener);
    focusWhileVisible.length = 0;
    await user.click(screen.getByRole("button", { name: "Confirmar cancelación" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cancelar.");
    await waitFor(() => expect(opener).toHaveFocus());
    expect(focusWhileVisible).toEqual([true]);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("restores focus after a successful cancellation before refreshing", async () => {
    const user = userEvent.setup();
    mocks.cancel.mockResolvedValue({ status: "success", recurringExpenseId: props.recurringExpenseId });
    render(<RecurringExpenseLifecycleControl {...props} status="active" />);

    const opener = screen.getByRole("button", { name: "Cancelar recurrencia Coworking" });
    const focusWhileVisible = simulateBrowserFocusRules(opener);
    await user.click(opener);
    focusWhileVisible.length = 0;
    await user.click(screen.getByRole("button", { name: "Confirmar cancelación" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Recurrencia cancelada.");
    await waitFor(() => expect(opener).toHaveFocus());
    expect(focusWhileVisible).toEqual([true]);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
