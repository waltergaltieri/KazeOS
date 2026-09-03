export default function ExpensesLoading() {
  return (
    <main className="loading-ledger" aria-busy="true" aria-label="Cargando gastos">
      <div className="loading-ledger__heading">
        <span className="skeleton skeleton--eyebrow" />
        <span className="skeleton skeleton--title" />
      </div>
      <div className="loading-ledger__rail">
        {Array.from({ length: 6 }, (_, index) => <span key={index} className="skeleton skeleton--row" />)}
      </div>
    </main>
  );
}
