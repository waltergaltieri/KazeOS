import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "./page";

const { cashFlowMocks, dashboardMocks } = vi.hoisted(() => ({
  cashFlowMocks: { getMonthlyCashFlow: vi.fn() },
  dashboardMocks: {
  getDashboardMetrics: vi.fn(),
  getPendingTasks: vi.fn(),
  getUpcomingCharges: vi.fn(),
  getUpcomingMovements: vi.fn(),
  },
}));

vi.mock("@/lib/queries/dashboard", () => dashboardMocks);
vi.mock("@/lib/queries/cash-flow", () => cashFlowMocks);
vi.mock("@/lib/actions/payments", () => ({ createPaymentAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const zeroMoney = { USD: "0", ARS: "0" } as const;

describe("the authenticated dashboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T15:00:00.000Z"));
    dashboardMocks.getDashboardMetrics.mockResolvedValue({ collectedThisMonth: zeroMoney, pending: zeroMoney, overdue: zeroMoney, mrr: zeroMoney, expensesThisMonth: zeroMoney, projectedBalance: zeroMoney, activeClients: 0, chargesNextSevenDays: 0 });
    dashboardMocks.getUpcomingCharges.mockResolvedValue([]);
    dashboardMocks.getPendingTasks.mockResolvedValue([]);
    dashboardMocks.getUpcomingMovements.mockResolvedValue([]);
    cashFlowMocks.getMonthlyCashFlow.mockResolvedValue({
      USD: { projectedIncome: "0", actualIncome: "0", projectedExpenses: "0", actualExpenses: "0", projectedNet: "0", actualNet: "0" },
      ARS: { projectedIncome: "0", actualIncome: "0", projectedExpenses: "0", actualExpenses: "0", projectedNet: "0", actualNet: "0" },
    });
  });

  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it("loads every dashboard projection once with the same business date", async () => {
    render(await DashboardPage());

    expect(screen.getByRole("heading", { name: "Resumen diario" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Próximos cobros" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Tareas pendientes" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Próximos movimientos" })).toBeVisible();
    expect(screen.getByRole("heading", { name: /Ingresos/ })).toBeVisible();

    for (const query of [dashboardMocks.getDashboardMetrics, dashboardMocks.getPendingTasks, dashboardMocks.getUpcomingCharges, dashboardMocks.getUpcomingMovements]) {
      expect(query).toHaveBeenCalledOnce();
      expect(query).toHaveBeenCalledWith("2026-08-15");
    }
    expect(cashFlowMocks.getMonthlyCashFlow).toHaveBeenCalledOnce();
    expect(cashFlowMocks.getMonthlyCashFlow).toHaveBeenCalledWith("2026-08-01", "2026-09-01");
    expect(screen.getByRole("region", { name: "Ingresos vs gastos — este mes" })).toBeVisible();
    expect(screen.queryByText(/últimos 6 meses/i)).not.toBeInTheDocument();
  });

  it("shows actionable empty states instead of fabricated records", async () => {
    render(await DashboardPage());

    expect(screen.getByText("Sin cobros pendientes")).toBeVisible();
    expect(screen.getByText("Agenda despejada")).toBeVisible();
    expect(screen.getByText("Sin movimientos próximos")).toBeVisible();
    expect(screen.getByRole("link", { name: "Crear primer cobro" })).toHaveAttribute("href", "/charges/new");
    expect(screen.queryByText(/Empresa Demo/i)).not.toBeInTheDocument();
  });
});
