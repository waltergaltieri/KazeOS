export default function AppLoading() {
  return (
    <div className="loading-ledger" aria-busy="true" aria-label="Cargando contenido">
      <div className="loading-ledger__heading">
        <span className="skeleton skeleton--eyebrow" />
        <span className="skeleton skeleton--title" />
      </div>
      <div className="loading-ledger__grid">
        <span className="skeleton skeleton--card" />
        <span className="skeleton skeleton--card" />
        <span className="skeleton skeleton--card" />
      </div>
      <div className="loading-ledger__rail">
        <span className="skeleton skeleton--row" />
        <span className="skeleton skeleton--row" />
        <span className="skeleton skeleton--row" />
      </div>
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
