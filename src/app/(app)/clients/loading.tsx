export default function ClientsLoading() {
  return (
    <main className="loading-ledger" aria-busy="true" aria-label="Cargando clientes">
      <div className="loading-ledger__heading"><span className="skeleton skeleton--eyebrow" /><span className="skeleton skeleton--title" /></div>
      <div className="loading-ledger__rail">{Array.from({ length: 6 }, (_, index) => <span className="skeleton skeleton--row" key={index} />)}</div>
    </main>
  );
}
