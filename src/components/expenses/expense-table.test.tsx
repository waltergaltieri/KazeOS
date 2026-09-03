import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/expenses", () => ({
  cancelExpenseAction: vi.fn(),
  correctPaidExpenseAction: vi.fn(),
  deleteExpenseAction: vi.fn(),
  markExpensePaidAction: vi.fn(),
}));

import type { ExpenseListItem } from "@/lib/queries/expenses";
import { ExpenseTable } from "./expense-table";

const base: ExpenseListItem = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Servidor principal",
  description: "Infraestructura productiva",
  amountMinor: 12_500,
  currency: "USD",
  scope: "business",
  costType: "fixed",
  dueDate: "2026-09-05",
  paidDate: null,
  status: "overdue",
  persistedStatus: "pending",
  paymentMethod: null,
  vendor: "Nube Sur",
  notes: null,
  periodKey: null,
  generatedAutomatically: false,
  category: { id: "22222222-2222-4222-8222-222222222222", name: "Software", icon: "server", active: true },
  recurringExpense: null,
};

describe("ExpenseTable", () => {
  it("renders a dense ledger and equivalent mobile cards", () => {
    const recurring = { ...base, recurringExpense: { id: "33333333-3333-4333-8333-333333333333", title: "Servidor", status: "active" as const, frequency: "monthly" as const } };
    const { container } = render(<ExpenseTable expenses={[recurring]} today="2026-09-10" />);

    for (const column of ["Gasto / proveedor", "Categoría", "Ámbito", "Tipo", "Vencimiento", "Estado", "Importe"]) {
      expect(screen.getByRole("columnheader", { name: column })).toBeInTheDocument();
    }
    expect(container.querySelector(".expense-table-wrap")).toBeInTheDocument();
    expect(container.querySelector(".expense-card-list")).toBeInTheDocument();
    expect(screen.getAllByText("Servidor principal")).toHaveLength(2);
    expect(screen.getAllByText("Nube Sur")).toHaveLength(2);
    expect(screen.getAllByText("05/09/2026")).toHaveLength(2);
    expect(screen.getAllByText("Software")).toHaveLength(2);
    expect(screen.getAllByText("Vencido")).toHaveLength(2);
    expect(screen.getAllByText("Negocio")).toHaveLength(2);
    expect(screen.getAllByText("Fijo")).toHaveLength(2);
    const recurringBadges = screen.getAllByText("Recurrente");
    expect(recurringBadges).toHaveLength(2);
    expect(recurringBadges.every((badge) => badge.classList.contains("expense-classification--recurring"))).toBe(true);
    expect(container.querySelectorAll(".money-data")).toHaveLength(2);
    expect([...container.querySelectorAll(".money-data")].every((node) => node.textContent === "USD 125,00")).toBe(true);
  });

  it("gives the mobile payment action a full-width 44px touch target", () => {
    const { container } = render(<ExpenseTable expenses={[base]} today="2026-09-10" />);
    expect(container.querySelector(".expense-card footer > .primary-button")).toHaveAccessibleName("Registrar pago de Servidor principal");

    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/\.expense-card footer > \.primary-button\s*\{[^}]*grid-column:\s*1\s*\/\s*-1[^}]*width:\s*100%[^}]*min-height:\s*44px[^}]*\}/);
  });

  it("keeps payment, edit, duplicate, cancel and allowed delete actions available", async () => {
    const user = userEvent.setup();
    render(<ExpenseTable expenses={[base]} today="2026-09-10" />);

    expect(screen.getAllByRole("button", { name: "Registrar pago de Servidor principal" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Editar gasto Servidor principal" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Duplicar gasto Servidor principal" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Cancelar gasto Servidor principal" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Eliminar gasto Servidor principal" })).toHaveLength(2);

    await user.click(screen.getAllByRole("button", { name: "Registrar pago de Servidor principal" })[0]);
    expect(screen.getByRole("dialog", { name: "Registrar pago de Servidor principal" })).toBeInTheDocument();
  });

  it("routes generated rows to their recurrence and hides forbidden deletion", () => {
    const recurring = {
      ...base,
      generatedAutomatically: true,
      recurringExpense: {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Servidor",
        status: "active" as const,
        frequency: "monthly" as const,
      },
    };
    render(<ExpenseTable expenses={[recurring]} today="2026-09-10" />);

    expect(screen.getAllByRole("link", { name: "Editar recurrencia de Servidor principal" })[0]).toHaveAttribute(
      "href",
      "/expenses/recurring/33333333-3333-4333-8333-333333333333/edit",
    );
    expect(screen.queryByRole("link", { name: "Editar gasto Servidor principal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar gasto Servidor principal" })).not.toBeInTheDocument();
  });

  it("keeps the recurrence edit route on historical generated rows", () => {
    render(<ExpenseTable expenses={[{
      ...base,
      paidDate: "2026-09-05",
      persistedStatus: "paid",
      status: "paid",
      generatedAutomatically: true,
      recurringExpense: {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Servidor",
        status: "active",
        frequency: "monthly",
      },
    }]} today="2026-09-10" />);

    expect(screen.getAllByRole("link", { name: "Editar recurrencia de Servidor principal" })).toHaveLength(2);
  });

  it("offers creation from the empty state", () => {
    render(<ExpenseTable expenses={[]} today="2026-09-10" />);

    expect(screen.getByRole("heading", { name: "No hay gastos para esta vista" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nuevo gasto" })).toHaveAttribute("href", "/expenses/new");
  });
});
