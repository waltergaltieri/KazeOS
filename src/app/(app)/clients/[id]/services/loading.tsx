export default function ServicesLoading() {
  return (
    <main className="loading-ledger" aria-label="Cargando servicios" aria-busy="true">
      <div className="loading-ledger__heading">
        <span className="skeleton skeleton--eyebrow" />
        <span className="skeleton skeleton--title" />
      </div>
      <div className="loading-ledger__rail">
        <span className="skeleton skeleton--row" />
      </div>
      <div className="loading-ledger__grid">
        <span className="skeleton skeleton--card" />
        <span className="skeleton skeleton--card" />
        <span className="skeleton skeleton--card" />
      </div>
      <span className="sr-only">Cargando servicios…</span>
    </main>
  );
}
