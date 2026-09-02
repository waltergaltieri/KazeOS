import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/payments", () => ({
  createPaymentAction: vi.fn(),
  correctPaymentAction: vi.fn(),
}));

import { KpiStrip } from "./kpi-strip";
import { PendingTasks } from "./pending-tasks";
import { RevenueTrend } from "./revenue-trend";
import { UpcomingCharges } from "./upcoming-charges";
import { UpcomingMovements } from "./upcoming-movements";

const metrics = {
  collectedThisMonth: { USD: "6000", ARS: "18014398509486982" },
  pending: { USD: "70000", ARS: "20000" },
  overdue: { USD: "8000", ARS: "0" },
  mrr: { USD: "22000", ARS: "10000" },
  activeClients: 2,
  chargesNextSevenDays: 2,
} as const;

describe("dashboard components", () => {
  it("renders exact currency-separated KPIs without coercing aggregate strings", () => {
    const { rerender } = render(<KpiStrip metrics={metrics} selectedCurrency="USD" />);

    expect(screen.getByRole("heading", { name: "Cobrado este mes" })).toBeVisible();
    expect(screen.getByText("Este mes calendario")).toBeVisible();
    expect(screen.getByText(/USD\s+80,00/)).toBeVisible();
    expect(screen.queryByText(/ARS\s+180\.143\.985\.094\.869,82/)).not.toBeInTheDocument();

    rerender(<KpiStrip metrics={metrics} selectedCurrency="ARS" />);
    expect(screen.getByText(/ARS\s+180\.143\.985\.094\.869,82/)).toBeVisible();
    expect(screen.queryByText(/USD\s+80,00/)).not.toBeInTheDocument();
    expect(screen.getAllByText("2", { selector: ".dashboard-count-card strong" })).toHaveLength(2);
    expect(screen.getByText("Clientes activos")).toBeVisible();
    expect(screen.getByText("Próximos 7 días")).toBeVisible();
  });

  it("renders actionable charge/task lists and a unified chronological rail", () => {
    render(
      <>
        <UpcomingCharges
          today="2026-08-15"
          charges={[
            { id: "11111111-1111-4111-8111-111111111111", clientId: "21111111-1111-4111-8111-111111111111", clientName: "Estudio Norte", description: "Hosting vencido", amountMinor: 10_000, amountPaidMinor: 2_000, outstandingMinor: "8000", currency: "USD", dueDate: "2026-08-10", status: "partial", isOverdue: true },
            { id: "31111111-1111-4111-8111-111111111111", clientId: "41111111-1111-4111-8111-111111111111", clientName: "Cliente Global", description: "Diseño de hoy", amountMinor: 20_000, amountPaidMinor: 0, outstandingMinor: "20000", currency: "ARS", dueDate: "2026-08-15", status: "due_today", isOverdue: false },
          ]}
        />
        <PendingTasks
          today="2026-08-15"
          tasks={[
            { id: "51111111-1111-4111-8111-111111111111", clientId: null, clientName: null, title: "Renovar dominio", dueDate: "2026-08-14", priority: "high", isOverdue: true },
          ]}
        />
        <UpcomingMovements
          movements={[
            { id: "61111111-1111-4111-8111-111111111111", kind: "charge", label: "Hosting vencido", context: "Estudio Norte", date: "2026-08-10", amountMinor: "8000", currency: "USD", priority: null, isOverdue: true },
            { id: "71111111-1111-4111-8111-111111111111", kind: "task", label: "Renovar dominio", context: null, date: "2026-08-14", amountMinor: null, currency: null, priority: "high", isOverdue: true },
          ]}
        />
      </>,
    );

    const rows = screen.getAllByTestId("upcoming-charge");
    expect(rows[0]).toHaveTextContent("Hosting vencido");
    expect(screen.getByRole("button", { name: "Registrar pago de Hosting vencido" })).toBeVisible();
    expect(screen.getByText("Vencida", { selector: ".dashboard-date-state" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Tareas pendientes" })).toBeVisible();
    expect(screen.getByRole("list", { name: "Próximos movimientos" })).toHaveTextContent("Hosting vencido");
    expect(screen.getByRole("list", { name: "Próximos movimientos" })).toHaveTextContent("Renovar dominio");
  });

  it("shows useful six-month currency trends and CTA-backed empty states", () => {
    const { rerender } = render(
      <RevenueTrend
        points={[
          { month: "2026-03", USD: "1000", ARS: "1000000000" },
          { month: "2026-04", USD: "2000", ARS: "1200000000" },
          { month: "2026-05", USD: "3000", ARS: "1400000000" },
          { month: "2026-06", USD: "4000", ARS: "1600000000" },
          { month: "2026-07", USD: "5000", ARS: "1800000000" },
          { month: "2026-08", USD: "6000", ARS: "2000000000" },
        ]}
      />,
    );
    expect(screen.getByText("USD · escala propia")).toBeVisible();
    expect(screen.getByText("ARS · escala propia")).toBeVisible();
    expect(screen.getByText(/Mín\. USD\s+10,00/)).toBeVisible();
    expect(screen.getByText(/Máx\. USD\s+60,00/)).toBeVisible();
    expect(screen.getByText(/Mín\. ARS\s+10\.000\.000,00/)).toBeVisible();
    expect(screen.getByText(/Máx\. ARS\s+20\.000\.000,00/)).toBeVisible();
    expect(screen.getByRole("img", { name: "Tendencia de ingresos USD con escala propia" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Tendencia de ingresos ARS con escala propia" })).toBeVisible();
    expect(screen.queryByRole("img", { name: "Ingresos mensuales de USD y ARS" })).not.toBeInTheDocument();

    const exactData = screen.getByRole("table", { name: "Datos exactos de ingresos de los últimos 6 meses" });
    expect(within(exactData).getByRole("row", { name: /Marzo 2026 USD\s+10,00 ARS\s+10\.000\.000,00/ })).toBeInTheDocument();
    expect(within(exactData).getByRole("row", { name: /Agosto 2026 USD\s+60,00 ARS\s+20\.000\.000,00/ })).toBeInTheDocument();

    for (const currency of ["usd", "ars"]) {
      const points = document.querySelector(`.dashboard-chart-line--${currency}`)!.getAttribute("points")!;
      const range = points.split(" ").map((point) => Number(point.split(",")[1]));
      expect(Math.max(...range) - Math.min(...range)).toBeGreaterThan(80);
    }

    rerender(<UpcomingCharges charges={[]} today="2026-08-15" />);
    expect(screen.getByRole("link", { name: "Crear primer cobro" })).toHaveAttribute("href", "/charges/new");
    rerender(<PendingTasks tasks={[]} today="2026-08-15" />);
    expect(screen.getByRole("link", { name: "Crear primera tarea" })).toHaveAttribute("href", "/tasks/new");
    rerender(<UpcomingMovements movements={[]} />);
    expect(screen.getByRole("link", { name: "Agregar movimiento" })).toHaveAttribute("href", "/charges/new");
  });
});
