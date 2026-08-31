export default function DashboardLoading() {
  return (
    <main className="dashboard-page" aria-busy="true" aria-label="Cargando resumen diario">
      <div className="dashboard-loading-heading dashboard-skeleton" />
      <div className="dashboard-financial-strip">
        {Array.from({ length: 4 }, (_, index) => <div className="dashboard-loading-card dashboard-skeleton" key={index} />)}
      </div>
      <div className="dashboard-operational-grid">
        <div className="dashboard-loading-panel dashboard-skeleton" />
        <div className="dashboard-loading-panel dashboard-skeleton" />
      </div>
    </main>
  );
}
