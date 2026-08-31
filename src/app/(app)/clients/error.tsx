"use client";

import { RotateCcw } from "lucide-react";

export default function ClientsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="client-error" role="alert">
      <p className="eyebrow">No se pudo abrir la cartera</p>
      <h1>Algo interrumpió la consulta.</h1>
      <p>Tu información no fue modificada. Intentá cargar los clientes otra vez.</p>
      <button className="primary-button" type="button" onClick={reset}><RotateCcw size={17} aria-hidden="true" /> Reintentar</button>
    </main>
  );
}
