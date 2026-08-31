import Link from "next/link";

const tabs = [
  { label: "Resumen", available: true },
  { label: "Servicios", available: false },
  { label: "Cobros", available: false },
  { label: "Tareas", available: false },
  { label: "Notas", available: false },
] as const;

export function ClientTabs({ clientId }: { clientId: string }) {
  return (
    <nav className="client-tabs" aria-label="Secciones del legajo">
      {tabs.map((tab) =>
        tab.available ? (
          <Link key={tab.label} href={`/clients/${clientId}`} aria-current="page">{tab.label}</Link>
        ) : (
          <span key={tab.label} aria-disabled="true" title="Disponible en una próxima etapa">{tab.label}</span>
        ),
      )}
    </nav>
  );
}
