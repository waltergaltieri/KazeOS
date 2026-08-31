"use client";

import { Archive, Building2, Edit3, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { archiveClientAction, type ClientActionState } from "@/lib/actions/clients";

const initialState: ClientActionState = { status: "idle" };

export function ClientHeader({ client }: { client: { id: string; firstName: string; lastName: string | null; company: string | null; status: "active" | "paused" | "archived" } }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(archiveClientAction, initialState);
  const router = useRouter();
  const archiveTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const name = [client.firstName, client.lastName].filter(Boolean).join(" ");

  useEffect(() => {
    if (state.status === "success") router.replace("/clients?filter=archived");
  }, [router, state.status]);

  useEffect(() => {
    if (confirming) confirmButtonRef.current?.focus();
  }, [confirming]);

  function cancelArchive() {
    setConfirming(false);
    requestAnimationFrame(() => archiveTriggerRef.current?.focus());
  }

  return (
    <header className="client-dossier-header">
      <div>
        <p className="eyebrow">Legajo de cliente</p>
        <h1>{name}</h1>
        <p className="client-dossier-subtitle"><Building2 size={15} aria-hidden="true" /> {client.company || "Cliente independiente"}</p>
      </div>
      <div className="client-header-actions">
        <Link className="secondary-button" href={`/clients/${client.id}/edit`}><Edit3 size={16} aria-hidden="true" /> Editar</Link>
        {client.status !== "archived" ? (
          confirming ? (
            <form action={action} className="archive-confirm">
              <input type="hidden" name="id" value={client.id} />
              <span>¿Archivar este legajo?</span>
              <button ref={confirmButtonRef} className="danger-button" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Archive size={16} />} Confirmar</button>
              <button className="quiet-button" type="button" onClick={cancelArchive}>Cancelar</button>
            </form>
          ) : (
            <button ref={archiveTriggerRef} className="quiet-button" type="button" onClick={() => setConfirming(true)}><Archive size={16} aria-hidden="true" /> Archivar</button>
          )
        ) : <span className="status-pill status-pill--archived">Archivado</span>}
      </div>
      {state.status === "error" ? <p className="form-error" role="alert">{state.message}</p> : null}
    </header>
  );
}
