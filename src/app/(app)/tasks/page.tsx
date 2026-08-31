import { Plus } from "lucide-react";
import Link from "next/link";

import { TaskFilters } from "@/components/tasks/task-filters";
import { TaskList } from "@/components/tasks/task-list";
import { todayInBusinessZone } from "@/lib/domain/commercial-date";
import { getTaskFilterOptions, getTasks } from "@/lib/queries/tasks";
import type { TaskFilters as TaskFilterValues } from "@/lib/validations/task";

const statusValues = ["all", "today", "upcoming", "overdue", "completed", "undated"] as const;
const priorityValues = ["low", "medium", "high"] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const today = todayInBusinessZone(new Date());
  const status = statusValues.includes(params.status as typeof statusValues[number]) ? params.status as typeof statusValues[number] : "all";
  const priority = priorityValues.includes(params.priority as typeof priorityValues[number]) ? params.priority as typeof priorityValues[number] : undefined;
  const input: Partial<TaskFilterValues> & { q?: string } = { q: params.q, status, clientId: params.clientId || undefined, priority };
  const [items, clients] = await Promise.all([getTasks(input, today), getTaskFilterOptions()]);
  const filtersApplied = Boolean(params.q || params.clientId || params.priority || (params.status && params.status !== "all"));
  return <main className="tasks-page"><header className="page-heading page-heading--actions"><div><p className="eyebrow">Agenda operativa</p><h1>Tareas</h1><p>Lo urgente primero, cada seguimiento unido a su cliente.</p></div><Link className="primary-button" href="/tasks/new"><Plus size={17} aria-hidden="true" /> Nueva tarea</Link></header><TaskFilters basePath="/tasks" clients={clients} params={input} /><div className="client-result-count" aria-live="polite">{items.length} {items.length === 1 ? "tarea" : "tareas"}</div><TaskList basePath="/tasks" tasks={items} today={today} filtersApplied={filtersApplied} /></main>;
}
