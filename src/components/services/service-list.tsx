"use client";

import { CalendarDays, Edit3, LoaderCircle, Pause, Plus, Repeat2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { deactivateServiceAction, type ServiceActionState } from "@/lib/actions/services";
import { formatMoney } from "@/lib/domain/money";
import type { ServiceListItem } from "@/lib/queries/services";

const initialState: ServiceActionState = { status: "idle" };
const statusLabel = { active: "Activo", paused: "En pausa", cancelled: "Cancelado" } as const;
const frequencyLabel = { monthly: "Mensual", quarterly: "Trimestral", yearly: "Anual", one_time: "Único" } as const;

function cadence(service: ServiceListItem) {
  if (service.billingType === "one_time") return "Cargo único";
  return `${frequencyLabel[service.billingFrequency]} · día ${service.billingDay}`;
}

function formattedDate(value: string | null) {
  if (!value) return "Sin próximo cargo";
  return new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function ServiceList({
  clientId,
  services: items,
}: {
  clientId: string;
  services: ServiceListItem[];
}) {
  if (items.length === 0) {
    return (
      <section className="service-empty" aria-labelledby="service-empty-title">
        <span aria-hidden="true"><Repeat2 size={23} /></span>
        <div>
          <p className="eyebrow">Sin acuerdos</p>
          <h2 id="service-empty-title">Todavía no hay acuerdos</h2>
          <p>Definí el primer servicio para proyectar sus próximos cobros.</p>
        </div>
        <Link className="primary-button" href={`/clients/${clientId}/services/new`}><Plus size={17} aria-hidden="true" /> Crear servicio</Link>
      </section>
    );
  }

  return (
    <section className="service-card-grid" aria-label="Servicios del cliente">
      {items.map((service) => (
        <article className="service-card" key={service.id}>
          <span className="service-card__rail" aria-hidden="true" />
          <header>
            <div>
              <p className="eyebrow">{service.billingType === "recurring" ? "Acuerdo recurrente" : "Servicio único"}</p>
              <h2>{service.name}</h2>
            </div>
            <span className={`status-pill status-pill--${service.status}`}>{statusLabel[service.status]}</span>
          </header>
          <strong className="service-amount">{formatMoney(service.amountMinor, service.currency)}</strong>
          <dl className="service-facts">
            <div><dt>Cadencia</dt><dd>{cadence(service)}</dd></div>
            <div><dt>Próximo</dt><dd><CalendarDays size={14} aria-hidden="true" />{formattedDate(service.nextDueDate)}</dd></div>
            <div><dt>Generación</dt><dd>{service.automaticChargeGeneration ? "Automático" : "Manual"}</dd></div>
          </dl>
          <footer>
            <Link className="secondary-button" href={`/clients/${clientId}/services/${service.id}/edit`}><Edit3 size={15} aria-hidden="true" /> Editar</Link>
            {service.status === "active" ? <ServicePauseControl clientId={clientId} service={service} /> : null}
          </footer>
        </article>
      ))}
    </section>
  );
}

function ServicePauseControl({ clientId, service }: { clientId: string; service: ServiceListItem }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(deactivateServiceAction, initialState);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  function cancel() {
    setConfirming(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  if (!confirming) {
    return <button ref={triggerRef} className="quiet-button" type="button" aria-label={`Pausar ${service.name}`} onClick={() => setConfirming(true)}><Pause size={15} aria-hidden="true" /> Pausar</button>;
  }

  return (
    <form action={action} className="service-pause-confirm">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="serviceId" value={service.id} />
      <span>¿Pausar este acuerdo?</span>
      <button ref={confirmRef} className="danger-button" type="submit" disabled={pending} aria-label="Confirmar pausa">
        {pending ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />} Confirmar
      </button>
      <button className="quiet-button" type="button" onClick={cancel}>Cancelar</button>
      {state.status === "error" ? <small className="field-error" role="alert">{state.message}</small> : null}
    </form>
  );
}
