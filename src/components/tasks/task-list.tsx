"use client";

import { CalendarCheck2, Check, Pencil, Repeat2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { completeTaskAction, deleteTaskAction, reopenTaskAction, type TaskActionState } from "@/lib/actions/tasks";
import type { TaskListItem } from "@/lib/queries/tasks";

const initial: TaskActionState = { status: "idle" };
const priorityLabels = { high: "Prioridad alta", medium: "Prioridad media", low: "Prioridad baja" } as const;

function dateState(task: TaskListItem, today: string) {
  if (task.status === "completed") return "Completada";
  if (!task.dueDate) return "Sin fecha";
  if (task.dueDate < today) return "Vencida";
  if (task.dueDate === today) return "Hoy";
  return task.dueDate.split("-").reverse().join("/");
}

function TaskStatusControl({ task }: { task: TaskListItem }) {
  const action = task.status === "completed" ? reopenTaskAction : completeTaskAction;
  const [state, formAction, pending] = useActionState(action, initial);
  return <form action={formAction} className="task-check-form"><input type="hidden" name="taskId" value={task.id} /><button type="submit" role="checkbox" aria-checked={task.status === "completed"} aria-label={`${task.status === "completed" ? "Reabrir" : "Completar"} ${task.title}`} disabled={pending} className="task-checkbox">{task.status === "completed" ? <Check size={15} /> : null}</button>{state.status === "error" ? <span className="sr-only" role="alert">{state.message}</span> : null}</form>;
}

function TaskDeleteControl({ task }: { task: TaskListItem }) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(deleteTaskAction, initial);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const deletesSeries = task.parentId === null && (task.recurring || task.hasOccurrences);
  const occurrence = task.parentId !== null;
  const accessibleAction = deletesSeries ? `Eliminar serie ${task.title}` : occurrence ? `Eliminar ocurrencia ${task.title}` : `Eliminar tarea ${task.title}`;
  const description = deletesSeries ? "Se eliminarán la tarea raíz y todas sus ocurrencias. Esta acción no se puede deshacer." : occurrence ? "Se eliminará sólo esta ocurrencia. La raíz y las demás ocurrencias se conservan." : "Se eliminará sólo esta tarea. Esta acción no se puede deshacer.";
  useEffect(() => { if (confirming) confirmRef.current?.focus(); }, [confirming]);
  if (!confirming) return <button ref={openerRef} type="button" className="icon-button" aria-label={`Eliminar ${task.title}`} onClick={() => setConfirming(true)}><Trash2 size={15} /></button>;
  return <form action={formAction} className="task-delete-confirm" role="group" aria-labelledby={titleId} aria-describedby={descriptionId}><input type="hidden" name="taskId" value={task.id} /><input type="hidden" name="deleteScope" value={deletesSeries ? "series" : "single"} /><strong id={titleId}>{accessibleAction}</strong><span id={descriptionId}>{description}</span><button ref={confirmRef} className="danger-button" aria-label={accessibleAction} disabled={pending}>{deletesSeries ? "Eliminar serie" : occurrence ? "Eliminar ocurrencia" : "Eliminar tarea"}</button><button type="button" className="quiet-button" onClick={() => { setConfirming(false); requestAnimationFrame(() => openerRef.current?.focus()); }}>Volver</button>{state.status === "error" ? <small className="field-error" role="alert">{state.message}</small> : null}</form>;
}

export function TaskList({ basePath, tasks, today, filtersApplied = false, createHref = "/tasks/new" }: { basePath: string; tasks: TaskListItem[]; today: string; filtersApplied?: boolean; createHref?: string }) {
  if (!tasks.length) return <section className="task-empty"><CalendarCheck2 size={23} aria-hidden="true" /><div><h2>{filtersApplied ? "No encontramos tareas" : "Tu agenda está al día"}</h2><p>{filtersApplied ? "Probá otra búsqueda o quitá los filtros aplicados." : "Creá el próximo seguimiento para mantener el trabajo en movimiento."}</p></div><Link className={filtersApplied ? "secondary-button" : "primary-button"} href={filtersApplied ? basePath : createHref}>{filtersApplied ? "Limpiar filtros" : "Crear tarea"}</Link></section>;
  return <section className="task-ledger" aria-label="Agenda de tareas"><ol>{tasks.map((task) => <li key={task.id} className={`task-row task-row--${task.status} ${task.status === "pending" && task.dueDate && task.dueDate < today ? "is-overdue" : ""}`}><TaskStatusControl task={task} /><span className="task-row__rail" aria-hidden="true" /><div className="task-row__body"><div className="task-row__heading"><strong>{task.title}</strong><span className={`task-date task-date--${dateState(task, today).toLowerCase().replace(" ", "-")}`}>{dateState(task, today)}</span></div><div className="task-row__meta"><span>{task.clientName ?? "Tarea general"}</span><span className={`task-priority task-priority--${task.priority}`}>{priorityLabels[task.priority]}</span>{task.recurring || task.parentId ? <span className="task-recurring"><Repeat2 size={12} aria-hidden="true" /> Mensual</span> : null}</div>{task.description ? <p>{task.description}</p> : null}</div><div className="task-row__actions"><Link className="icon-button" href={`/tasks/${task.id}/edit`} aria-label={`Editar ${task.title}`}><Pencil size={15} /></Link><TaskDeleteControl task={task} /></div></li>)}</ol></section>;
}
