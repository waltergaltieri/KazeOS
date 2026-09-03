import { IncomeExpenseComparison } from "@/components/dashboard/income-expense-comparison";
import { KpiStrip } from "@/components/dashboard/kpi-strip";
import { PendingTasks } from "@/components/dashboard/pending-tasks";
import { UpcomingCharges } from "@/components/dashboard/upcoming-charges";
import { UpcomingMovements } from "@/components/dashboard/upcoming-movements";
import { addCommercialPeriod, todayInBusinessZone } from "@/lib/domain/commercial-date";
import { getMonthlyCashFlow } from "@/lib/queries/cash-flow";
import {
  getDashboardMetrics,
  getPendingTasks,
  getUpcomingCharges,
  getUpcomingMovements,
} from "@/lib/queries/dashboard";

export default async function DashboardPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ currency?: string | string[] }> } = {}) {
  const requestedCurrency = (await searchParams).currency;
  const selectedCurrency = requestedCurrency === "ARS" ? "ARS" : "USD";
  const today = todayInBusinessZone(new Date());
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = addCommercialPeriod(monthStart, "monthly");
  const [metrics, upcomingCharges, pendingTasks, upcomingMovements, cashFlow] = await Promise.all([
    getDashboardMetrics(today),
    getUpcomingCharges(today),
    getPendingTasks(today),
    getUpcomingMovements(today),
    getMonthlyCashFlow(monthStart, monthEnd),
  ]);

  return (
    <main className="dashboard-page" aria-labelledby="dashboard-title">
      <header className="dashboard-page__heading">
        <p className="eyebrow">Agenda operativa</p>
        <h1 id="dashboard-title">Resumen diario</h1>
        <p>Lo que entró, lo que vence y lo que necesita tu atención.</p>
      </header>

      <KpiStrip metrics={metrics} selectedCurrency={selectedCurrency} />
      <div className="dashboard-operational-grid">
        <UpcomingCharges charges={upcomingCharges} today={today} />
        <PendingTasks tasks={pendingTasks} today={today} />
      </div>
      <div className="dashboard-insight-grid">
        <UpcomingMovements movements={upcomingMovements} />
        <IncomeExpenseComparison cashFlow={cashFlow} selectedCurrency={selectedCurrency} />
      </div>
    </main>
  );
}
