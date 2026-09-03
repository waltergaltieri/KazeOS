import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExpenseBreakdowns } from "./expense-breakdowns";

const byCategory = [
  { categoryId: "software", label: "Software", icon: "💻", amounts: { USD: "60000" as const, ARS: "0" as const } },
  { categoryId: "office", label: "Oficina", icon: null, amounts: { USD: "40000" as const, ARS: "120000" as const } },
];
const byScope = [
  { key: "business" as const, amounts: { USD: "75000" as const, ARS: "80000" as const } },
  { key: "personal" as const, amounts: { USD: "25000" as const, ARS: "40000" as const } },
];
const byCostType = [
  { key: "fixed" as const, amounts: { USD: "70000" as const, ARS: "90000" as const } },
  { key: "variable" as const, amounts: { USD: "30000" as const, ARS: "30000" as const } },
];

describe("ExpenseBreakdowns", () => {
  it("ranks category, scope and type inside the selected currency only", () => {
    const { rerender } = render(
      <ExpenseBreakdowns byCategory={byCategory} byScope={byScope} byCostType={byCostType} currency="USD" />,
    );

    const categories = screen.getByRole("region", { name: "Gastos por categoría" });
    expect(within(categories).getByText("Software")).toBeInTheDocument();
    expect(within(categories).getByText("60%")).toBeInTheDocument();
    expect(within(categories).getByText(/USD\s+600,00/)).toBeInTheDocument();
    expect(within(categories).getByText("Oficina")).toBeInTheDocument();
    expect(within(categories).getByText("40%")).toBeInTheDocument();

    const scopes = screen.getByRole("region", { name: "Gastos por ámbito" });
    expect(within(scopes).getByText("Negocio")).toBeInTheDocument();
    expect(within(scopes).getByText("75%")).toBeInTheDocument();
    expect(within(scopes).getByText("Personal")).toBeInTheDocument();

    const types = screen.getByRole("region", { name: "Gastos fijos y variables" });
    expect(within(types).getByText("Fijos")).toBeInTheDocument();
    expect(within(types).getByText("70%")).toBeInTheDocument();
    expect(within(types).getByText("Variables")).toBeInTheDocument();

    rerender(<ExpenseBreakdowns byCategory={byCategory} byScope={byScope} byCostType={byCostType} currency="ARS" />);
    expect(screen.queryByText(/USD\s+600,00/)).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Gastos por categoría" })).getByText(/ARS\s+1\.200,00/)).toBeInTheDocument();
  });

  it("renders a useful zero state without dividing by zero", () => {
    render(<ExpenseBreakdowns byCategory={[]} byScope={[]} byCostType={[]} currency="USD" />);

    expect(screen.getAllByText("Sin gastos proyectados en este período.")).toHaveLength(3);
    expect(screen.queryByText("NaN%")).not.toBeInTheDocument();
  });

  it("labels every unavailable breakdown without claiming the period is empty", () => {
    render(<ExpenseBreakdowns currency="USD" unavailable />);

    expect(screen.getAllByText("No disponible")).toHaveLength(3);
    expect(screen.getAllByText("No pudimos cargar este desglose.")).toHaveLength(3);
    expect(screen.queryByText("Sin gastos proyectados en este período.")).not.toBeInTheDocument();
  });
});
