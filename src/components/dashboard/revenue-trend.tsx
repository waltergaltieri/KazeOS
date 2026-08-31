import { formatAggregateMoney, type AggregateMinorUnits, type Currency } from "@/lib/domain/money";
import type { MonthlyRevenuePoint } from "@/lib/queries/dashboard";

const shortMonthLabels = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const fullMonthLabels = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const width = 600;
const height = 108;
const inset = 10;

function extent(values: AggregateMinorUnits[]) {
  if (!values.length) return { minimum: "0" as const, maximum: "0" as const };
  return values.reduce(
    (current, value) => ({
      minimum: BigInt(value) < BigInt(current.minimum) ? value : current.minimum,
      maximum: BigInt(value) > BigInt(current.maximum) ? value : current.maximum,
    }),
    { minimum: values[0], maximum: values[0] },
  );
}

function coordinates(values: AggregateMinorUnits[], minimum: AggregateMinorUnits, maximum: AggregateMinorUnits) {
  const range = BigInt(maximum) - BigInt(minimum);
  return values.map((value, index) => {
    const x = inset + ((width - inset * 2) * index) / Math.max(values.length - 1, 1);
    const scaled = range === BigInt(0) ? BigInt(0) : ((BigInt(value) - BigInt(minimum)) * BigInt(10_000)) / range;
    const y = height - inset - ((height - inset * 2) * Number(scaled)) / 10_000;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function monthName(month: string) {
  const [year, number] = month.split("-");
  return `${fullMonthLabels[Number(number) - 1]} ${year}`;
}

function MiniTrend({ currency, points }: { currency: Currency; points: MonthlyRevenuePoint[] }) {
  const values = points.map((point) => point[currency]);
  const { minimum, maximum } = extent(values);
  return (
    <figure className={`dashboard-mini-trend dashboard-mini-trend--${currency.toLowerCase()}`}>
      <figcaption>{currency} · escala propia</figcaption>
      <div className="dashboard-mini-scale"><span>Mín. {formatAggregateMoney(minimum, currency)}</span><span>Máx. {formatAggregateMoney(maximum, currency)}</span></div>
      <svg role="img" aria-label={`Tendencia de ingresos ${currency} con escala propia`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <line x1={inset} y1={height - inset} x2={width - inset} y2={height - inset} />
        <polyline className={`dashboard-chart-line dashboard-chart-line--${currency.toLowerCase()}`} points={coordinates(values, minimum, maximum)} />
      </svg>
      <div className="dashboard-chart-months" aria-hidden="true">
        {points.map((point) => <span key={point.month}>{shortMonthLabels[Number(point.month.slice(5)) - 1]}</span>)}
      </div>
    </figure>
  );
}

export function RevenueTrend({ points }: { points: MonthlyRevenuePoint[] }) {
  return (
    <section className="dashboard-panel dashboard-revenue" aria-labelledby="revenue-title">
      <header className="dashboard-panel__heading">
        <div><p className="eyebrow">Lectura secundaria</p><h2 id="revenue-title">Ingresos · últimos 6 meses</h2></div>
        <p className="dashboard-scale-note">Cada moneda se lee por separado</p>
      </header>
      <div className="dashboard-small-multiples">
        <MiniTrend currency="USD" points={points} />
        <MiniTrend currency="ARS" points={points} />
      </div>
      <table className="sr-only" aria-label="Datos exactos de ingresos de los últimos 6 meses">
        <thead><tr><th scope="col">Mes</th><th scope="col">USD</th><th scope="col">ARS</th></tr></thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.month}>
              <th scope="row">{monthName(point.month)}</th>
              <td>{formatAggregateMoney(point.USD, "USD")}</td>
              <td>{formatAggregateMoney(point.ARS, "ARS")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
