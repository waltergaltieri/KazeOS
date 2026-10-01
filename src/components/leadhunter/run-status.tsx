type Run = { id: string; state: string; counts: Record<string, number>; scheduledFor: Date; finishedAt: Date | null };

export function RunStatus({ runs }: { runs: Run[] }) {
  const latest = runs[0];
  return <section className="leadhunter-panel"><header><p className="eyebrow">Ejecuciones</p><h2>Actividad del agente</h2></header>{latest ? <div className="run-status-grid"><div><span>Estado actual</span><strong>{latest.state}</strong></div><div><span>Trabajos</span><strong>{latest.counts.total ?? 0}</strong></div><div><span>Completados</span><strong>{latest.counts.succeeded ?? 0}</strong></div><div><span>Fallidos</span><strong>{latest.counts.failed ?? 0}</strong></div></div> : <p>Todavía no se realizó ninguna búsqueda.</p>}</section>;
}
