import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "./page";

const dashboardMocks = vi.hoisted(() => ({
  getDashboardMetrics: vi.fn(),
  getMonthlyRevenue: vi.fn(),
  getPendingTasks: vi.fn(),
  getUpcomingCharges: vi.fn(),
  getUpcomingMovements: vi.fn(),
}));

vi.mock("@/lib/queries/dashboard", () => dashboardMocks);
vi.mock("@/lib/actions/payments", () => ({ createPaymentAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const zeroMoney = { USD: "0", ARS: "0" } as const;

describe("the authenticated dashboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T15:00:00.000Z"));
    dashboardMocks.getDashboardMetrics.mockResolvedValue({ collectedThisMonth: zeroMoney, pending: zeroMoney, overdue: zeroMoney, mrr: zeroMoney, activeClients: 0, chargesNextSevenDays: 0 });
    dashboardMocks.getUpcomingCharges.mockResolvedValue([]);
    dashboardMocks.getPendingTasks.mockResolvedValue([]);
    dashboardMocks.getUpcomingMovements.mockResolvedValue([]);
    dashboardMocks.getMonthlyRevenue.mockResolvedValue([
      { month: "2026-03", USD: "0", ARS: "0" }, { month: "2026-04", USD: "0", ARS: "0" },
      { month: "2026-05", USD: "0", ARS: "0" }, { month: "2026-06", USD: "0", ARS: "0" },
      { month: "2026-07", USD: "0", ARS: "0" }, { month: "2026-08", USD: "0", ARS: "0" },
    ]);
  });

  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it("loads every dashboard projection once with the same business date", async () => {
    render(await DashboardPage());

    expect(screen.getByRole("heading", { name: "Resumen diario" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Próximos cobros" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Tareas pendientes" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Próximos movimientos" })).toBeVisible();
    expect(screen.getByRole("heading", { name: /Ingresos/ })).toBeVisible();

    for (const query of Object.values(dashboardMocks)) {
      expect(query).toHaveBeenCalledOnce();
      expect(query).toHaveBeenCalledWith("2026-08-15");
    }
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
