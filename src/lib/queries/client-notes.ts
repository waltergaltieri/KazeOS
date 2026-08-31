import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { withAuthenticatedDb } from "@/db";
import { clientNotes } from "@/db/schema";
import { requireUser } from "@/lib/auth/require-user";
import { clientIdSchema } from "@/lib/validations/client";

export interface ClientNoteItem {
  id: string;
  clientId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function getClientNotes(clientIdInput: unknown): Promise<ClientNoteItem[]> {
  const clientId = clientIdSchema.parse(clientIdInput);
  const user = await requireUser();
  return withAuthenticatedDb(user.id, (database) => database
    .select({
      id: clientNotes.id,
      clientId: clientNotes.clientId,
      content: clientNotes.content,
      createdAt: clientNotes.createdAt,
      updatedAt: clientNotes.updatedAt,
    })
    .from(clientNotes)
    .where(and(eq(clientNotes.ownerId, user.id), eq(clientNotes.clientId, clientId)))
    .orderBy(desc(clientNotes.createdAt), desc(clientNotes.id)));
}
