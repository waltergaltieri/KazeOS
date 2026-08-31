import Link from "next/link";

const tabs = [
  { key: "summary", label: "Resumen", available: true },
  { key: "services", label: "Servicios", available: true },
  { key: "charges", label: "Cobros", available: true },
  { key: "tasks", label: "Tareas", available: true },
  { key: "notes", label: "Notas", available: false },
] as const;

type AvailableTab = "summary" | "services" | "charges" | "tasks";

export function ClientTabs({
  clientId,
  active = "summary",
}: {
  clientId: string;
  active?: AvailableTab;
}) {
  return (
    <nav className="client-tabs" aria-label="Secciones del legajo">
      {tabs.map((tab) =>
        tab.available ? (
          <Link
            key={tab.key}
            href={tab.key === "summary" ? `/clients/${clientId}` : `/clients/${clientId}/${tab.key}`}
            aria-current={tab.key === active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ) : (
          <span key={tab.key} aria-disabled="true" title="Disponible en una próxima etapa">{tab.label}</span>
        ),
      )}
    </nav>
  );
}
