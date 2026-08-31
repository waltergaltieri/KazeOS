"use client";
export default function SettingsError({ reset }: { reset: () => void }) { return <main className="settings-page"><section className="empty-state"><div><h1>No pudimos abrir la configuración</h1><p>Reintentá para recuperar tus preferencias.</p></div><button className="primary-button" onClick={reset}>Reintentar</button></section></main>; }
