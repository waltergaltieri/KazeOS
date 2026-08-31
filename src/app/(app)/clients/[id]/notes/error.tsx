"use client";
export default function ClientNotesError({ reset }: { reset: () => void }) { return <main className="client-detail-page"><section className="empty-state"><div><h1>No pudimos abrir las notas</h1><p>Reintentá para recuperar la cronología del cliente.</p></div><button className="primary-button" onClick={reset}>Reintentar</button></section></main>; }
