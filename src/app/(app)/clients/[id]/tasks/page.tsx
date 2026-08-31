import { Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ClientHeader } from "@/components/clients/client-header";
import { ClientTabs } from "@/components/clients/client-tabs";
import { TaskFilters } from "@/components/tasks/task-filters";
import { TaskList } from "@/components/tasks/task-list";
import { todayInBusinessZone } from "@/lib/domain/commercial-date";
import { getClientById } from "@/lib/queries/clients";
import { getTasks } from "@/lib/queries/tasks";
import type { TaskFilters as TaskFilterValues } from "@/lib/validations/task";

const statusValues = ["all", "today", "upcoming", "overdue", "completed", "undated"] as const;
const priorityValues = ["low", "medium", "high"] as const;

export default async function ClientTasksPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const today = todayInBusinessZone(new Date());
  const status = statusValues.includes(query.status as typeof statusValues[number]) ? query.status as typeof statusValues[number] : "all";
  const priority = priorityValues.includes(query.priority as typeof priorityValues[number]) ? query.priority as typeof priorityValues[number] : undefined;
  const input: Partial<TaskFilterValues> & { q?: string } = { q: query.q, status, clientId: id, priority };
  const [client, items] = await Promise.all([getClientById(id), getTasks(input, today)]);
  if (!client) notFound();
  const basePath = `/clients/${id}/tasks`;
  const filtersApplied = Boolean(query.q || query.priority || (query.status && query.status !== "all"));
  return <main className="client-detail-page tasks-page"><ClientHeader client={client!} /><ClientTabs clientId={id} active="tasks" /><header className="service-page-heading"><div><p className="eyebrow">Seguimientos del legajo</p><h2>Tareas</h2><p>Compromisos y próximos pasos vinculados a este cliente.</p></div><Link className="primary-button" href={`/tasks/new?clientId=${id}`}><Plus size={17} aria-hidden="true" /> Nueva tarea</Link></header><TaskFilters basePath={basePath} clients={[]} fixedClientId={id} params={input} /><TaskList basePath={basePath} createHref={`/tasks/new?clientId=${id}`} tasks={items} today={today} filtersApplied={filtersApplied} /></main>;
}
