import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/recurring-expenses", () => ({
  cancelRecurringExpenseAction: vi.fn(),
  pauseRecurringExpenseAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import type { RecurringExpenseListItem } from "@/lib/queries/expenses";
import { RecurringExpenseList } from "./recurring-expense-list";

const item: RecurringExpenseListItem = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Coworking",
  description: null,
  amountMinor: 30_000,
  currency: "USD",
  scope: "business",
  costType: "fixed",
  frequency: "monthly",
  billingDay: 10,
  startDate: "2026-01-10",
  endDate: null,
  status: "active",
  paymentMethod: "bank_transfer",
  vendor: "Central",
  notes: null,
  automaticGeneration: true,
  category: { id: "22222222-2222-4222-8222-222222222222", name: "Alquiler", icon: null, active: true },
};

describe("RecurringExpenseList", () => {
  it("shows cadence, next due date, amount and active state", () => {
    render(<RecurringExpenseList recurringExpenses={[item]} today="2026-09-03" />);

    expect(screen.getByText(/Mensual · día 10/)).toBeInTheDocument();
    expect(screen.getByText("Próximo: 10/09/2026")).toBeInTheDocument();
    expect(screen.getByText("Activa")).toBeInTheDocument();
    expect(document.querySelector(".money-data")).toHaveTextContent("USD 300,00");
    expect(screen.getByRole("link", { name: "Editar recurrencia Coworking" })).toHaveAttribute("href", "/expenses/recurring/11111111-1111-4111-8111-111111111111/edit");
    expect(screen.getByRole("button", { name: "Pausar recurrencia Coworking" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancelar recurrencia Coworking" })).toBeVisible();
  });

  it("does not offer a dead edit action for cancelled commitments", () => {
    render(<RecurringExpenseList recurringExpenses={[{ ...item, status: "cancelled" }]} today="2026-09-03" />);

    expect(screen.getByText("Cancelada")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Editar recurrencia Coworking" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /recurrencia Coworking/ })).not.toBeInTheDocument();
  });

  it("does not offer pause for an already paused commitment", () => {
    render(<RecurringExpenseList recurringExpenses={[{ ...item, status: "paused" }]} today="2026-09-03" />);

    expect(screen.queryByRole("button", { name: "Pausar recurrencia Coworking" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar recurrencia Coworking" })).toBeVisible();
  });
});
