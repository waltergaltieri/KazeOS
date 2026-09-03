import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
  });

  it("does not offer a dead edit action for cancelled commitments", () => {
    render(<RecurringExpenseList recurringExpenses={[{ ...item, status: "cancelled" }]} today="2026-09-03" />);

    expect(screen.getByText("Cancelada")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Editar recurrencia Coworking" })).not.toBeInTheDocument();
  });
});
