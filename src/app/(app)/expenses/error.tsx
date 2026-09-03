"use client";

export default function ExpensesError({ reset }: { reset: () => void }) {
  return (
    <main className="client-error">
      <p className="eyebrow">Libro interrumpido</p>
      <h1>No pudimos abrir los gastos</h1>
      <p>La información sigue protegida. Probá cargarla otra vez.</p>
      <button className="primary-button" type="button" onClick={reset}>Reintentar</button>
    </main>
  );
}
