"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { LedgerSelect } from "@/components/ui/ledger-select";
import type { TaskActionState } from "@/lib/actions/tasks";

type TaskAction = (state: TaskActionState, data: FormData) => Promise<TaskActionState>;
type TaskDefaults = {
  id?: string;
  clientId?: string | null;
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  priority?: "low" | "medium" | "high";
  status?: "pending" | "completed";
  recurring?: boolean;
  recurrence?: "monthly" | null;
  parentId?: string | null;
};

const initialState: TaskActionState = { status: "idle" };

export function TaskForm({ action, clients, defaults, defaultClientId }: { action: TaskAction; clients: { id: string; label: string }[]; defaults?: TaskDefaults; defaultClientId?: string }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [recurring, setRecurring] = useState(Boolean(defaults?.recurring));
  const router = useRouter();
  const generatedOccurrence = Boolean(defaults?.parentId);

  useEffect(() => {
    if (state.status !== "success") return;
    router.replace(state.clientId ? `/clients/${state.clientId}/tasks` : "/tasks");
  }, [router, state]);

  const error = (field: string) => state.fieldErrors?.[field]?.[0];
  return (
    <form action={formAction} className="form-sheet task-form" noValidate>
      {defaults?.id ? <input type="hidden" name="taskId" value={defaults.id} /> : null}
      <input type="hidden" name="status" value={defaults?.status ?? "pending"} />
      <div className="form-grid form-grid--two">
        <label className="field-stack"><span>Título *</span><input className="form-control" name="title" defaultValue={defaults?.title ?? ""} maxLength={200} aria-invalid={Boolean(error("title")) || undefined} aria-describedby={error("title") ? "task-title-error" : undefined} autoFocus />{error("title") ? <small className="field-error" id="task-title-error">{error("title")}</small> : null}</label>
        <label className="field-stack"><span>Cliente</span><LedgerSelect name="clientId" label="Cliente" defaultValue={defaults?.clientId ?? defaultClientId ?? ""} options={[{ value: "", label: "Sin cliente" }, ...clients.map((client) => ({ value: client.id, label: client.label }))]} error={error("clientId")} />{error("clientId") ? <small className="field-error">{error("clientId")}</small> : null}</label>
        <label className="field-stack"><span>Vencimiento</span><input className="form-control" name="dueDate" inputMode="numeric" placeholder="AAAA-MM-DD" defaultValue={defaults?.dueDate ?? ""} aria-invalid={Boolean(error("dueDate")) || undefined} />{error("dueDate") ? <small className="field-error">{error("dueDate")}</small> : null}</label>
        <label className="field-stack"><span>Prioridad</span><LedgerSelect name="priority" label="Prioridad" defaultValue={defaults?.priority ?? "medium"} options={[{ value: "low", label: "Baja" }, { value: "medium", label: "Media" }, { value: "high", label: "Alta" }]} error={error("priority")} /></label>
      </div>
      <label className="field-stack"><span>Descripción</span><textarea className="form-control" name="description" rows={4} maxLength={2000} defaultValue={defaults?.description ?? ""} /></label>
      <section className="task-recurrence-field" aria-label="Recurrencia">
        <label><input type="checkbox" name="recurring" aria-label="Repetir mensualmente" checked={recurring} disabled={generatedOccurrence} onChange={(event) => setRecurring(event.target.checked)} /><span><strong>Repetir mensualmente</strong><small>{generatedOccurrence ? "Esta ocurrencia continúa la serie original." : "Ideal para seguimientos y cierres periódicos."}</small></span></label>
        <input type="hidden" name="recurrence" value={recurring && !generatedOccurrence ? "monthly" : ""} />
        {recurring && !generatedOccurrence ? <p>Al completar la tarea se creará la siguiente instancia, una sola vez y con el mismo día cuando exista.</p> : null}
        {error("recurrence") ? <small className="field-error">{error("recurrence")}</small> : null}
      </section>
      {state.message ? <p className="form-error" role="alert">{state.message}</p> : null}
      <footer className="client-form__actions"><button className="primary-button" disabled={pending}>{pending ? "Guardando…" : defaults?.id ? "Guardar cambios" : "Crear tarea"}</button></footer>
    </form>
  );
}
