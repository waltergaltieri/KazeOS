"use client";

export default function ServicesError({ reset }: { reset: () => void }) {
  return (
    <main className="client-error">
      <p className="eyebrow">No pudimos abrir el libro</p>
      <h1>Los servicios no están disponibles</h1>
      <p>Probá nuevamente. Tus acuerdos y cargos no fueron modificados.</p>
      <button className="primary-button" type="button" onClick={reset}>
        Reintentar
      </button>
    </main>
  );
}
