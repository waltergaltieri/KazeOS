import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IncomeExpenseComparison } from "./income-expense-comparison";

const cashFlow = {
  USD: { projectedIncome: "70000", actualIncome: "6000", projectedExpenses: "4000", actualExpenses: "1000", projectedNet: "66000", actualNet: "5000" },
  ARS: { projectedIncome: "20000", actualIncome: "5000", projectedExpenses: "3000", actualExpenses: "2000", projectedNet: "17000", actualNet: "3000" },
} as const;

describe("IncomeExpenseComparison", () => {
  it("shows projected income, expenses and net for only the selected currency", () => {
    const { rerender } = render(<IncomeExpenseComparison cashFlow={cashFlow} selectedCurrency="USD" />);
    const region = screen.getByRole("region", { name: "Ingresos vs gastos — este mes" });

    expect(within(region).getByText(/USD\s+700,00/)).toBeVisible();
    expect(within(region).getByText(/USD\s+40,00/)).toBeVisible();
    expect(within(region).getByText(/USD\s+660,00/)).toBeVisible();
    expect(within(region).queryByText(/ARS/)).not.toBeInTheDocument();
    expect(within(region).getByRole("link", { name: "Ver gastos" })).toHaveAttribute("href", "/expenses");

    rerender(<IncomeExpenseComparison cashFlow={cashFlow} selectedCurrency="ARS" />);
    expect(within(region).getByText(/ARS\s+200,00/)).toBeVisible();
    expect(within(region).getByText(/ARS\s+30,00/)).toBeVisible();
    expect(within(region).getByText(/ARS\s+170,00/)).toBeVisible();
    expect(within(region).queryByText(/USD/)).not.toBeInTheDocument();
  });
});
