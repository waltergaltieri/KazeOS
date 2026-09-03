import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MonthlyCashFlow } from "@/lib/domain/cash-flow";
import type { ExpenseSummary as ExpenseSummaryData } from "@/lib/queries/expenses";
import { ExpenseSummary } from "./expense-summary";

const summary: ExpenseSummaryData = {
  USD: {
    actual: "50100",
    pending: "30200",
    overdue: "10300",
    projected: "80400",
    fixed: "60500",
    variable: "19900",
    monthlyFixedCommitments: "45100",
  },
  ARS: {
    actual: "150100",
    pending: "130200",
    overdue: "110300",
    projected: "280400",
    fixed: "160500",
    variable: "119900",
    monthlyFixedCommitments: "145100",
  },
};

const cashFlow: MonthlyCashFlow = {
  USD: {
    projectedIncome: "200000",
    actualIncome: "140000",
    projectedExpenses: "80000",
    actualExpenses: "50000",
    projectedNet: "120000",
    actualNet: "90000",
  },
  ARS: {
    projectedIncome: "100000",
    actualIncome: "80000",
    projectedExpenses: "140000",
    actualExpenses: "95000",
    projectedNet: "-40000",
    actualNet: "-15000",
  },
};

describe("ExpenseSummary", () => {
  it("shows six exact metrics and projected versus actual results for one currency", () => {
    const { rerender } = render(
      <ExpenseSummary summary={summary} cashFlow={cashFlow} currency="USD" />,
    );

    const metrics = screen.getByRole("region", { name: "Resumen de gastos USD" });
    for (const label of ["Gastado", "Pendiente", "Vencido", "Proyectado", "Fijo", "Variable"]) {
      expect(within(metrics).getByText(label)).toBeInTheDocument();
    }
    for (const value of [/USD\s+501,00/, /USD\s+302,00/, /USD\s+103,00/, /USD\s+804,00/, /USD\s+605,00/, /USD\s+199,00/]) {
      expect(within(metrics).getByText(value)).toBeInTheDocument();
    }

    expect(screen.getByText("Compromiso fijo mensual")).toBeInTheDocument();
    expect(screen.getByText(/USD\s+451,00/)).toBeInTheDocument();

    const projected = screen.getByRole("group", { name: "Resultado proyectado" });
    expect(within(projected).getByText(/USD\s+2\.000,00/)).toBeInTheDocument();
    expect(within(projected).getByText(/USD\s+-800,00/)).toBeInTheDocument();
    expect(within(projected).getByText(/USD\s+1\.200,00/)).toBeInTheDocument();

    const actual = screen.getByRole("group", { name: "Resultado real" });
    expect(within(actual).getByText(/USD\s+1\.400,00/)).toBeInTheDocument();
    expect(within(actual).getByText(/USD\s+-500,00/)).toBeInTheDocument();
    expect(within(actual).getByText(/USD\s+900,00/)).toBeInTheDocument();

    rerender(<ExpenseSummary summary={summary} cashFlow={cashFlow} currency="ARS" />);
    expect(screen.getByRole("region", { name: "Resumen de gastos ARS" })).toBeInTheDocument();
    expect(screen.queryByText(/USD\s+804,00/)).not.toBeInTheDocument();
    expect(screen.getByText(/ARS\s+2\.804,00/)).toBeInTheDocument();
  });

  it("exposes negative net results as deficits without hiding the exact amount", () => {
    render(<ExpenseSummary summary={summary} cashFlow={cashFlow} currency="ARS" />);

    expect(screen.getByText(/ARS\s+-400,00/)).toHaveClass("is-negative");
    expect(screen.getByText(/ARS\s+-150,00/)).toHaveClass("is-negative");
    expect(screen.getAllByText("Déficit")).toHaveLength(2);
  });

  it("labels a zero net as equilibrium instead of surplus", () => {
    const balanced: MonthlyCashFlow = {
      ...cashFlow,
      USD: { ...cashFlow.USD, projectedNet: "0", actualNet: "0" },
    };

    render(<ExpenseSummary summary={summary} cashFlow={balanced} currency="USD" />);

    expect(screen.getAllByText("Equilibrio")).toHaveLength(2);
    expect(screen.queryByText("Superávit")).not.toBeInTheDocument();
  });

  it("distinguishes unavailable analytics from a real zero balance", () => {
    render(<ExpenseSummary currency="USD" unavailable />);

    expect(screen.getByText("No disponible")).toBeInTheDocument();
    expect(screen.getByText("No pudimos cargar el resumen de gastos y caja.")).toBeInTheDocument();
    expect(screen.queryByText("Gastado")).not.toBeInTheDocument();
    expect(screen.queryByText(/USD\s+0,00/)).not.toBeInTheDocument();
    expect(screen.queryByText("Equilibrio")).not.toBeInTheDocument();
  });
});
