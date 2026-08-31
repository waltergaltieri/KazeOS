import { notFound } from "next/navigation";

import { TaskForm } from "@/components/tasks/task-form";
import { updateTaskAction } from "@/lib/actions/tasks";
import { getTaskById, getTaskFilterOptions } from "@/lib/queries/tasks";

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [task, clients] = await Promise.all([getTaskById(id), getTaskFilterOptions()]);
  if (!task) notFound();
  return <main className="task-editor-page"><header className="page-heading"><p className="eyebrow">Ficha de tarea</p><h1>Editar tarea</h1><p>El estado se cambia desde la casilla de la agenda; acá ajustás su contenido.</p></header><TaskForm action={updateTaskAction} clients={clients} defaults={task!} /></main>;
}
