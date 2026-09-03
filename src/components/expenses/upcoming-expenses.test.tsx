import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ExpenseListItem } from "@/lib/queries/expenses";
import { UpcomingExpenses } from "./upcoming-expenses";

function expense(overrides: Partial<ExpenseListItem> & Pick<ExpenseListItem, "id" | "title" | "dueDate" | "status">): ExpenseListItem {
  return {
    description: null,
    amountMinor: 10000,
    currency: "USD",
    scope: "business",
    costType: "fixed",
    paidDate: null,
    persistedStatus: "pending",
    paymentMethod: null,
    vendor: null,
    notes: null,
    periodKey: null,
    generatedAutomatically: false,
    category: { id: "category", name: "Software", icon: null, active: true },
    recurringExpense: null,
    ...overrides,
  };
}

describe("UpcomingExpenses", () => {
  it("keeps overdue obligations first, then orders chronologically and by selected currency", () => {
    render(<UpcomingExpenses currency="USD" today="2026-09-10" expenses={[
      expense({ id: "future", title: "Internet", dueDate: "2026-09-15", status: "pending", amountMinor: 22000 }),
      expense({ id: "ars", title: "Expensas", dueDate: "2026-09-01", status: "overdue", amountMinor: 99900, currency: "ARS" }),
      expense({ id: "overdue-late", title: "Hosting", dueDate: "2026-09-08", status: "overdue", amountMinor: 18000 }),
      expense({ id: "overdue-early", title: "Dominio", dueDate: "2026-09-04", status: "overdue", amountMinor: 9000 }),
    ]} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText("Dominio")).toBeInTheDocument();
    expect(within(items[1]).getByText("Hosting")).toBeInTheDocument();
    expect(within(items[2]).getByText("Internet")).toBeInTheDocument();
    expect(screen.queryByText("Expensas")).not.toBeInTheDocument();
    expect(screen.getByText(/USD\s+90,00/)).toBeInTheDocument();
    expect(screen.getAllByText("Vencido")).toHaveLength(2);
  });

  it("offers a direct action when there are no obligations in the selected currency", () => {
    render(<UpcomingExpenses currency="USD" today="2026-09-10" expenses={[]} />);

    expect(screen.getByText("No hay próximos gastos en USD.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Registrar gasto" })).toHaveAttribute("href", "/expenses/new");
  });
});
