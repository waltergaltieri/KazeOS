import { ArrowRight, CheckSquare2 } from "lucide-react";
import Link from "next/link";

import type { DashboardTask } from "@/lib/queries/dashboard";

const priorityLabels = { low: "Baja", medium: "Media", high: "Alta" } as const;

function dateState(date: string | null, today: string) {
  if (!date) return "Sin fecha";
  if (date < today) return "Vencida";
  if (date === today) return "Hoy";
  return date.split("-").reverse().join("/");
}

export function PendingTasks({ tasks, today }: { tasks: DashboardTask[]; today: string }) {
  return (
    <section className="dashboard-panel dashboard-pending-tasks" aria-labelledby="pending-tasks-title">
      <header className="dashboard-panel__heading"><div><p className="eyebrow">Agenda de trabajo</p><h2 id="pending-tasks-title">Tareas pendientes</h2></div><Link href="/tasks">Ver todas <ArrowRight size={14} /></Link></header>
      {tasks.length ? (
        <ol className="dashboard-task-list">
          {tasks.map((task) => <li key={task.id}><span className="dashboard-task-check" aria-hidden="true" /><div><strong>{task.title}</strong><span>{task.clientName ?? "Tarea general"}</span></div><time className={`dashboard-date-state${task.isOverdue ? " is-overdue" : ""}`} dateTime={task.dueDate ?? undefined}>{dateState(task.dueDate, today)}</time><span className={`dashboard-priority dashboard-priority--${task.priority}`}>{priorityLabels[task.priority]}</span></li>)}
        </ol>
      ) : (
        <div className="dashboard-module-empty"><span aria-hidden="true"><CheckSquare2 size={19} /></span><div><strong>Agenda despejada</strong><p>Agregá la primera tarea para verla en este resumen.</p></div><Link className="secondary-button" href="/tasks/new">Crear primera tarea</Link></div>
      )}
    </section>
  );
}
