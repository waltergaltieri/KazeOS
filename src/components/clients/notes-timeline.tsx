"use client";

import { Edit3, LoaderCircle, MessageSquarePlus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { createClientNoteAction, deleteClientNoteAction, updateClientNoteAction, type ClientNoteActionState } from "@/lib/actions/client-notes";
import type { ClientNoteItem } from "@/lib/queries/client-notes";

const initial: ClientNoteActionState = { status: "idle" };
const label = (content: string) => content.length > 48 ? `${content.slice(0, 45)}…` : content;

export function NotesTimeline({ clientId, notes }: { clientId: string; notes: ClientNoteItem[] }) {
  const [state, action, pending] = useActionState(createClientNoteAction, initial);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.status === "success") { formRef.current?.reset(); router.refresh(); } }, [router, state.status]);
  const ordered = [...notes].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id));
  return <div className="notes-layout">
    <form ref={formRef} action={action} className="note-compose" aria-labelledby="new-note-title">
      <input type="hidden" name="clientId" value={clientId} />
      <div><p className="eyebrow">Nuevo registro</p><h2 id="new-note-title">Agregar una nota</h2><p>Guardá contexto para la próxima conversación.</p></div>
      <label><span>Nueva nota</span><textarea name="content" className="form-control form-textarea" required maxLength={4000} aria-invalid={Boolean(state.fieldErrors?.content)} /></label>
      {state.status === "error" ? <p className="field-error" role="alert">{state.fieldErrors?.content?.[0] ?? state.message}</p> : null}
      {state.status === "success" ? <p className="form-success" role="status">Nota agregada.</p> : null}
      <button className="primary-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <MessageSquarePlus size={16} />} Agregar nota</button>
    </form>
    <section className="notes-sheet" aria-labelledby="notes-title"><header><p className="eyebrow">Cronología inversa</p><h2 id="notes-title">Notas del cliente</h2></header>
      {ordered.length ? <ol className="notes-timeline">{ordered.map((note) => <NoteRow key={note.id} note={note} />)}</ol> : <div className="notes-empty"><p>Todavía no hay notas.</p><span>La primera quedará visible acá.</span></div>}
    </section>
  </div>;
}

function NoteRow({ note }: { note: ClientNoteItem }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editState, editAction, editingPending] = useActionState(updateClientNoteAction, initial);
  const [deleteState, deleteAction, deletingPending] = useActionState(deleteClientNoteAction, initial);
  const router = useRouter();
  const editOpenerRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const deleteOpenerRef = useRef<HTMLButtonElement>(null);
  const deleteTitleId = useId();
  const noteLabel = label(note.content);
  useEffect(() => {
    if (editState.status === "success") {
      const frame = requestAnimationFrame(() => {
        setEditing(false);
        router.refresh();
        requestAnimationFrame(() => editOpenerRef.current?.focus());
      });
      return () => cancelAnimationFrame(frame);
    } else if (deleteState.status === "success") router.refresh();
  }, [deleteState.status, editState.status, router]);
  useEffect(() => { if (deleting) deleteButtonRef.current?.focus(); }, [deleting]);
  return <li className="note-entry">
    <div className="note-entry__meta"><time dateTime={note.createdAt.toISOString()}>{new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(note.createdAt)}</time>{note.updatedAt.getTime() !== note.createdAt.getTime() ? <span>Editada</span> : null}</div>
    {editing ? <form action={editAction} className="note-edit"><input type="hidden" name="noteId" value={note.id} /><input type="hidden" name="clientId" value={note.clientId} /><label><span className="sr-only">Editar nota {noteLabel}</span><textarea autoFocus name="content" className="form-control form-textarea" defaultValue={note.content} required maxLength={4000} /></label><div><button className="primary-button" disabled={editingPending}>Guardar</button><button type="button" className="quiet-button" onClick={() => setEditing(false)}>Cancelar</button></div>{editState.status === "error" ? <p role="alert" className="field-error">{editState.fieldErrors?.content?.[0] ?? editState.message}</p> : null}</form> : <p>{note.content}</p>}
    <div className="note-entry__actions"><button ref={editOpenerRef} type="button" className="quiet-button" aria-label={`Editar ${noteLabel}`} onClick={() => { setDeleting(false); setEditing(true); }}><Edit3 size={14} /> Editar</button><button ref={deleteOpenerRef} type="button" className="quiet-button" aria-label={`Eliminar ${noteLabel}`} onClick={() => { setEditing(false); setDeleting(true); }}><Trash2 size={14} /> Eliminar</button></div>
    {deleting ? <form action={deleteAction} className="note-delete-confirm" role="group" aria-labelledby={deleteTitleId}><input type="hidden" name="noteId" value={note.id} /><strong id={deleteTitleId}>Eliminar nota {noteLabel}</strong><span>La nota se quitará del historial. Esta acción no se puede deshacer.</span><button ref={deleteButtonRef} className="danger-button" disabled={deletingPending} aria-label={`Confirmar eliminación de ${noteLabel}`}>Eliminar nota</button><button type="button" className="quiet-button" onClick={() => { setDeleting(false); requestAnimationFrame(() => deleteOpenerRef.current?.focus()); }}>Volver</button>{deleteState.status === "error" ? <p role="alert" className="field-error">{deleteState.message}</p> : null}</form> : null}
  </li>;
}
