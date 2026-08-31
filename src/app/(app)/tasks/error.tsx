"use client";
export default function TasksError({ reset }: { reset: () => void }) { return <main className="client-error"><p className="eyebrow">Agenda interrumpida</p><h1>No pudimos abrir las tareas</h1><p>Los datos siguen protegidos. Probá cargar la agenda otra vez.</p><button className="primary-button" onClick={reset}>Reintentar</button></main>; }
