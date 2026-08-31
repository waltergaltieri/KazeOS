"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";

import { withAuthenticatedDb } from "@/db";
import { clientNotes } from "@/db/schema";
import { requireUser } from "@/lib/auth/require-user";
import { clientNoteFormSchema, clientNoteIdSchema } from "@/lib/validations/note";

export interface ClientNoteActionState {
  status: "idle" | "error" | "success";
  message?: string;
  noteId?: string;
  clientId?: string;
  fieldErrors?: Record<string, string[]>;
}

function invalid(error: ZodError): ClientNoteActionState {
  return { status: "error", message: "Revisá la nota.", fieldErrors: error.flatten().fieldErrors };
}

function revalidateClientHistory(clientId: string) {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/notes`);
}

export async function createClientNoteAction(_state: ClientNoteActionState, formData: FormData): Promise<ClientNoteActionState> {
  const parsed = clientNoteFormSchema.safeParse({ clientId: formData.get("clientId"), content: formData.get("content") });
  if (!parsed.success) return invalid(parsed.error);
  const user = await requireUser();
  try {
    const [created] = await withAuthenticatedDb(user.id, (database) => database.insert(clientNotes)
      .values({ ownerId: user.id, ...parsed.data })
      .returning({ id: clientNotes.id, clientId: clientNotes.clientId }));
    if (!created) return { status: "error", message: "No pudimos agregar la nota." };
    revalidateClientHistory(created.clientId);
    return { status: "success", noteId: created.id, clientId: created.clientId };
  } catch {
    return { status: "error", message: "No pudimos agregar la nota." };
  }
}

export async function updateClientNoteAction(_state: ClientNoteActionState, formData: FormData): Promise<ClientNoteActionState> {
  const noteId = clientNoteIdSchema.safeParse(formData.get("noteId"));
  const parsed = clientNoteFormSchema.safeParse({ clientId: formData.get("clientId"), content: formData.get("content") });
  if (!noteId.success) return { status: "error", message: "La nota no es válida." };
  if (!parsed.success) return invalid(parsed.error);
  const user = await requireUser();
  try {
    const [updated] = await withAuthenticatedDb(user.id, (database) => database.update(clientNotes)
      .set({ content: parsed.data.content, updatedAt: new Date() })
      .where(and(eq(clientNotes.id, noteId.data), eq(clientNotes.clientId, parsed.data.clientId), eq(clientNotes.ownerId, user.id)))
      .returning({ id: clientNotes.id, clientId: clientNotes.clientId }));
    if (!updated) return { status: "error", message: "No pudimos actualizar la nota." };
    revalidateClientHistory(updated.clientId);
    return { status: "success", noteId: updated.id, clientId: updated.clientId };
  } catch {
    return { status: "error", message: "No pudimos actualizar la nota." };
  }
}

export async function deleteClientNoteAction(_state: ClientNoteActionState, formData: FormData): Promise<ClientNoteActionState> {
  const noteId = clientNoteIdSchema.safeParse(formData.get("noteId"));
  if (!noteId.success) return { status: "error", message: "La nota no es válida." };
  const user = await requireUser();
  try {
    const [deleted] = await withAuthenticatedDb(user.id, (database) => database.delete(clientNotes)
      .where(and(eq(clientNotes.id, noteId.data), eq(clientNotes.ownerId, user.id)))
      .returning({ id: clientNotes.id, clientId: clientNotes.clientId }));
    if (!deleted) return { status: "error", message: "No pudimos eliminar la nota." };
    revalidateClientHistory(deleted.clientId);
    return { status: "success", noteId: deleted.id, clientId: deleted.clientId };
  } catch {
    return { status: "error", message: "No pudimos eliminar la nota." };
  }
}
