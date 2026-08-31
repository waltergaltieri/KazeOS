import { notFound } from "next/navigation";

import { TaskForm } from "@/components/tasks/task-form";
import { createTaskAction } from "@/lib/actions/tasks";
import { getTaskFilterOptions } from "@/lib/queries/tasks";

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<{ clientId?: string }> }) {
  const { clientId } = await searchParams;
  const clients = await getTaskFilterOptions();
  if (clientId && !clients.some((client) => client.id === clientId)) notFound();
  return <main className="task-editor-page"><header className="page-heading"><p className="eyebrow">Nuevo compromiso</p><h1>Crear tarea</h1><p>Definí el próximo paso y dejá visible cuándo necesita atención.</p></header><TaskForm action={createTaskAction} clients={clients} defaultClientId={clientId} /></main>;
}
