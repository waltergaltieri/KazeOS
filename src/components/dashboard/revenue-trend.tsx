import type { MonthlyRevenuePoint } from "@/lib/queries/dashboard";

const monthLabels = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const width = 600;
const height = 164;
const inset = 14;

function coordinates(values: string[], maximum: bigint) {
  return values.map((value, index) => {
    const x = inset + ((width - inset * 2) * index) / Math.max(values.length - 1, 1);
    const scaled = maximum === BigInt(0) ? BigInt(0) : (BigInt(value) * BigInt(10_000)) / maximum;
    const y = height - inset - ((height - inset * 2) * Number(scaled)) / 10_000;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export function RevenueTrend({ points }: { points: MonthlyRevenuePoint[] }) {
  const usdMaximum = points.reduce((current, point) => BigInt(point.USD) > current ? BigInt(point.USD) : current, BigInt(0));
  const arsMaximum = points.reduce((current, point) => BigInt(point.ARS) > current ? BigInt(point.ARS) : current, BigInt(0));
  return (
    <section className="dashboard-panel dashboard-revenue" aria-labelledby="revenue-title">
      <header className="dashboard-panel__heading"><div><p className="eyebrow">Lectura secundaria</p><h2 id="revenue-title">Ingresos · últimos 6 meses</h2></div><div className="dashboard-chart-legend"><span className="is-usd">USD</span><span className="is-ars">ARS</span></div></header>
      <div className="dashboard-chart-wrap">
        <svg role="img" aria-label="Ingresos mensuales de USD y ARS" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <line x1={inset} y1={height - inset} x2={width - inset} y2={height - inset} />
          <polyline className="dashboard-chart-line dashboard-chart-line--usd" points={coordinates(points.map((point) => point.USD), usdMaximum)} />
          <polyline className="dashboard-chart-line dashboard-chart-line--ars" points={coordinates(points.map((point) => point.ARS), arsMaximum)} />
        </svg>
        <div className="dashboard-chart-months">{points.map((point) => <span key={point.month}>{monthLabels[Number(point.month.slice(5)) - 1]}</span>)}</div>
      </div>
    </section>
  );
}
