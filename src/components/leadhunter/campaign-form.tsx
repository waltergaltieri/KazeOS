"use client";

import { LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import type { LeadHunterActionState } from "@/lib/actions/leadhunter";

type CampaignFormAction = (
  state: LeadHunterActionState,
  formData: FormData,
) => Promise<LeadHunterActionState>;

interface SequenceStep {
  delayDays: number;
  subjectInstruction: string;
  bodyInstruction: string;
}

const initialState: LeadHunterActionState = { status: "idle" };
const defaultSteps: SequenceStep[] = [
  {
    delayDays: 0,
    subjectInstruction: "Relacionar el asunto con una señal concreta del negocio",
    bodyInstruction: "Presentarse, explicar una mejora posible y cerrar con una pregunta breve",
  },
  {
    delayDays: 3,
    subjectInstruction: "Continuar el hilo anterior",
    bodyInstruction: "Aportar un ejemplo útil y preguntar si corresponde hablar con otra persona",
  },
];

const weekdays = [
  ["monday", "Lun"],
  ["tuesday", "Mar"],
  ["wednesday", "Mié"],
  ["thursday", "Jue"],
  ["friday", "Vie"],
] as const;

function FieldError({ message }: { message?: string }) {
  return message ? <small className="field-error">{message}</small> : null;
}

export function CampaignForm({ action }: { action: CampaignFormAction }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initialState);
  const [steps, setSteps] = useState(defaultSteps);
  const error = (field: string) => state.fieldErrors?.[field]?.[0];

  useEffect(() => {
    if (state.status === "success" && state.campaignId) {
      router.replace(`/leadhunter/campaigns/${state.campaignId}`);
    }
  }, [router, state]);

  function updateStep(index: number, patch: Partial<SequenceStep>) {
    setSteps((current) => current.map((step, position) =>
      position === index ? { ...step, ...patch } : step,
    ));
  }

  function addStep() {
    setSteps((current) => [
      ...current,
      {
        delayDays: (current.at(-1)?.delayDays ?? 0) + 3,
        subjectInstruction: "Continuar el hilo anterior",
        bodyInstruction: "Agregar valor sin repetir el mensaje anterior",
      },
    ]);
  }

  return (
    <form action={formAction} className="leadhunter-form" noValidate>
      <input type="hidden" name="sequenceSteps" value={JSON.stringify(steps)} />

      <section className="form-sheet" aria-labelledby="campaign-purpose">
        <header className="form-sheet__heading"><span>01</span><div><h2 id="campaign-purpose">Objetivo</h2><p>Definí el tipo de negocio y la ayuda que querés ofrecer.</p></div></header>
        <div className="form-grid form-grid--two">
          <label className="field-stack"><span>Nombre de la campaña *</span><input className="form-control" name="name" required placeholder="Mayoristas con pedidos manuales" aria-invalid={Boolean(error("name"))} /><FieldError message={error("name")} /></label>
          <label className="field-stack"><span>Servicio prioritario</span><select className="form-control" name="serviceFocus" defaultValue="custom_management"><option value="custom_management">Sistema de gestión a medida</option><option value="web">Sitio web</option><option value="ecommerce">Ecommerce</option><option value="ai_bots">Bot con IA</option><option value="automation">Automatización</option></select></label>
        </div>
        <label className="field-stack"><span>Qué negocios querés encontrar *</span><textarea className="form-control form-textarea" name="objective" required placeholder="Empresas que venden a comercios y todavía reciben pedidos de forma manual…" aria-invalid={Boolean(error("objective"))} /><FieldError message={error("objective")} /></label>
        <fieldset className="choice-fieldset"><legend>Mercados</legend><label><input type="checkbox" name="countries" value="AR" defaultChecked /> Argentina</label><label><input type="checkbox" name="countries" value="US" /> Estados Unidos</label></fieldset>
      </section>

      <section className="form-sheet" aria-labelledby="campaign-sources">
        <header className="form-sheet__heading"><span>02</span><div><h2 id="campaign-sources">Fuentes</h2><p>Las fuentes habilitadas participan de la búsqueda; las demás muestran qué conexión falta.</p></div></header>
        <div className="source-choice-grid">
          <label><input type="checkbox" name="sources" value="web_search" defaultChecked /><span><strong>Búsqueda web</strong><small>Buscadores y sitios públicos</small></span></label>
          <label><input type="checkbox" name="sources" value="directories" defaultChecked /><span><strong>Directorios</strong><small>Listados y cámaras habilitadas</small></span></label>
          <label><input type="checkbox" name="sources" value="csv" /><span><strong>Archivo CSV</strong><small>Importación manual posterior</small></span></label>
          <label><input type="checkbox" name="sources" value="manual" /><span><strong>Carga manual</strong><small>Prospectos que ya conocés</small></span></label>
          <label className="is-unavailable"><input type="checkbox" name="sources" value="instagram" disabled /><span><strong>Instagram</strong><small>Pendiente de conexión</small></span></label>
          <label className="is-unavailable"><input type="checkbox" name="sources" value="linkedin" disabled /><span><strong>LinkedIn</strong><small>Pendiente de conexión</small></span></label>
        </div>
        <FieldError message={error("sources")} />
      </section>

      <section className="form-sheet" aria-labelledby="campaign-criteria">
        <header className="form-sheet__heading"><span>03</span><div><h2 id="campaign-criteria">Criterios</h2><p>Escribí una señal por línea. Las negativas sirven para penalizar o excluir.</p></div></header>
        <div className="form-grid form-grid--two">
          <label className="field-stack"><span>Señales positivas</span><textarea className="form-control form-textarea" name="positiveCriteria" placeholder={"Catálogo mayorista\nPedidos por WhatsApp\nVarias sucursales"} /></label>
          <label className="field-stack"><span>Señales negativas</span><textarea className="form-control form-textarea" name="negativeCriteria" placeholder={"Ya es cliente\nNegocio cerrado\nFuera del mercado"} /></label>
        </div>
      </section>

      <section className="form-sheet" aria-labelledby="campaign-calendar">
        <header className="form-sheet__heading"><span>04</span><div><h2 id="campaign-calendar">Días, horarios y cupos</h2><p>La búsqueda y el envío tendrán calendarios separados.</p></div></header>
        <div className="campaign-schedule-grid">
          <div className="schedule-block"><strong>Búsquedas</strong><fieldset className="weekday-picker"><legend className="sr-only">Días de búsqueda</legend>{weekdays.map(([value,label]) => <label key={value}><input type="checkbox" name="searchDays" value={value} defaultChecked={value === "monday" || value === "wednesday"} /><span>{label}</span></label>)}</fieldset><label className="field-stack"><span>Hora</span><input className="form-control" name="searchTime" type="time" defaultValue="09:00" /></label><label className="field-stack"><span>Candidatos por corrida</span><input className="form-control" name="dailyLeadLimit" type="number" min="1" max="1000" defaultValue="30" /></label></div>
          <div className="schedule-block"><strong>Envíos</strong><fieldset className="weekday-picker"><legend className="sr-only">Días de envío</legend>{weekdays.map(([value,label]) => <label key={value}><input type="checkbox" name="sendDays" value={value} defaultChecked={value === "tuesday" || value === "thursday"} /><span>{label}</span></label>)}</fieldset><div className="form-grid form-grid--two"><label className="field-stack"><span>Desde</span><input className="form-control" name="sendStart" type="time" defaultValue="10:00" /></label><label className="field-stack"><span>Hasta</span><input className="form-control" name="sendEnd" type="time" defaultValue="16:00" /></label></div><label className="field-stack"><span>Correos por día</span><input className="form-control" name="dailyEmailLimit" type="number" min="1" max="1000" defaultValue="12" /></label></div>
        </div>
        <label className="field-stack campaign-timezone"><span>Zona horaria</span><select className="form-control" name="timezone" defaultValue="America/Argentina/Buenos_Aires"><option value="America/Argentina/Buenos_Aires">Buenos Aires</option><option value="America/New_York">Nueva York</option><option value="America/Chicago">Chicago</option><option value="America/Denver">Denver</option><option value="America/Los_Angeles">Los Ángeles</option></select></label>
        <FieldError message={error("sendEnd") ?? error("searchDays") ?? error("sendDays")} />
      </section>

      <section className="form-sheet" aria-labelledby="campaign-sequence">
        <header className="form-sheet__heading"><span>05</span><div><h2 id="campaign-sequence">Secuencia de correos</h2><p>Cada seguimiento se programa desde el envío anterior confirmado.</p></div></header>
        <div className="sequence-editor">
          {steps.map((step, index) => (
            <article key={index} className="sequence-step">
              <header><div><span>{index + 1}</span><h3>{index === 0 ? "Contacto inicial" : `Seguimiento ${index}`}</h3></div>{index > 0 ? <button type="button" className="icon-button" aria-label={`Eliminar seguimiento ${index}`} onClick={() => setSteps((current) => current.filter((_, position) => position !== index))}><Trash2 size={16} aria-hidden="true" /></button> : null}</header>
              {index > 0 ? <label className="field-stack"><span>Días después del contacto anterior</span><input className="form-control" type="number" min="1" max="365" value={step.delayDays} onChange={(event) => updateStep(index, { delayDays: Number(event.target.value) })} /></label> : null}
              <label className="field-stack"><span>Instrucción para el asunto</span><input className="form-control" value={step.subjectInstruction} onChange={(event) => updateStep(index, { subjectInstruction: event.target.value })} /></label>
              <label className="field-stack"><span>Qué debe comunicar</span><textarea className="form-control form-textarea" value={step.bodyInstruction} onChange={(event) => updateStep(index, { bodyInstruction: event.target.value })} /></label>
            </article>
          ))}
        </div>
        {steps.length < 12 ? <button type="button" className="secondary-button sequence-add" onClick={addStep}><Plus size={16} aria-hidden="true" /> Agregar seguimiento</button> : null}
        <FieldError message={error("sequenceSteps")} />
      </section>

      {state.status === "error" && state.message ? <p className="form-error" role="alert">{state.message}</p> : null}
      <footer className="leadhunter-form__actions"><p>Se guardará como borrador. No se enviarán correos.</p><button className="primary-button" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Save size={17} aria-hidden="true" />}{pending ? "Guardando…" : "Guardar campaña"}</button></footer>
    </form>
  );
}
