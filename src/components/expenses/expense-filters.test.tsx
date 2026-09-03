import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ExpenseFilters } from "./expense-filters";

const params = {
  q: "hosting",
  status: "overdue",
  period: "custom",
  month: "2026-09",
  from: "2026-09-01",
  to: "2026-09-30",
  categoryId: "11111111-1111-4111-8111-111111111111",
  scope: "business",
  costType: "fixed",
  recurrence: "recurring",
  currency: "USD",
};

describe("ExpenseFilters", () => {
  it("preserves every URL-backed dimension when status or period changes", () => {
    render(
      <ExpenseFilters
        params={params}
        categories={[{ id: params.categoryId, label: "Software" }]}
      />,
    );

    const paid = new URL(
      screen.getByRole("link", { name: "Pagados" }).getAttribute("href")!,
      "http://localhost",
    );
    expect(Object.fromEntries(paid.searchParams)).toEqual({
      ...params,
      status: "paid",
    });

    const currentMonth = new URL(
      screen.getByRole("link", { name: "Este mes" }).getAttribute("href")!,
      "http://localhost",
    );
    expect(Object.fromEntries(currentMonth.searchParams)).toEqual({
      q: "hosting",
      status: "overdue",
      period: "current_month",
      month: "2026-09",
      categoryId: params.categoryId,
      scope: "business",
      costType: "fixed",
      recurrence: "recurring",
      currency: "USD",
    });
  });

  it("keeps search scope and exposes custom dates plus every classification", () => {
    const { container } = render(
      <ExpenseFilters
        params={params}
        categories={[{ id: params.categoryId, label: "Software" }]}
      />,
    );

    const search = screen.getByRole("search");
    for (const [name, value] of Object.entries(params).filter(([name]) => name !== "q")) {
      expect(search.querySelector(`input[name="${name}"]`)).toHaveValue(value);
    }

    const form = container.querySelector(".expense-filter-fields")!;
    expect(form.querySelector('input[name="from"]')).toHaveValue("2026-09-01");
    expect(form.querySelector('input[name="to"]')).toHaveValue("2026-09-30");
    for (const label of ["Categoría", "Ámbito", "Tipo", "Recurrencia", "Moneda"]) {
      expect(screen.getByRole("combobox", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Limpiar filtros" })).toHaveAttribute("href", "/expenses");
  });

  it("requires both dates when a custom period is selected", async () => {
    const user = userEvent.setup();
    render(<ExpenseFilters params={{ period: "current_month" }} categories={[]} />);

    await user.click(screen.getByRole("combobox", { name: "Período" }));
    await user.click(screen.getByRole("option", { name: "Personalizado" }));

    expect(screen.getByLabelText("Desde")).toBeRequired();
    expect(screen.getByLabelText("Hasta")).toBeRequired();
  });

  it("synchronizes every control when URL params change in place", () => {
    const { rerender } = render(
      <ExpenseFilters
        params={params}
        categories={[{ id: params.categoryId, label: "Software" }]}
      />,
    );

    rerender(
      <ExpenseFilters
        params={{
          q: "seguro",
          status: "paid",
          period: "next_month",
          month: "2026-10",
          categoryId: "",
          scope: "family",
          costType: "variable",
          recurrence: "one_off",
          currency: "ARS",
        }}
        categories={[{ id: params.categoryId, label: "Software" }]}
      />,
    );

    expect(screen.getByRole("searchbox", { name: "Buscar gastos" })).toHaveValue("seguro");
    expect(screen.getByLabelText("Mes de referencia")).toHaveValue("2026-10");
    expect(screen.getByRole("combobox", { name: "Período" })).toHaveTextContent("Próximo mes");
    expect(screen.getByRole("combobox", { name: "Categoría" })).toHaveTextContent("Todas");
    expect(screen.getByRole("combobox", { name: "Ámbito" })).toHaveTextContent("Familia");
    expect(screen.getByRole("combobox", { name: "Tipo" })).toHaveTextContent("Variable");
    expect(screen.getByRole("combobox", { name: "Recurrencia" })).toHaveTextContent("Únicos");
    expect(screen.getByRole("combobox", { name: "Moneda" })).toHaveTextContent("ARS");
    expect(screen.getByLabelText("Desde")).toHaveValue("");
    expect(screen.getByLabelText("Hasta")).toHaveValue("");
    expect(screen.getByLabelText("Desde")).not.toBeRequired();
    expect(screen.getByLabelText("Hasta")).not.toBeRequired();
  });
});
