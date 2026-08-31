"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { withAuthenticatedDb } from "@/db";
import { clients } from "@/db/schema";
import { requireUser } from "@/lib/auth/require-user";
import {
  clientFormSchema,
  clientIdSchema,
  type ClientFormValues,
} from "@/lib/validations/client";

export interface ClientActionState {
  status: "idle" | "error" | "success";
  message?: string;
  clientId?: string;
  fieldErrors?: Record<string, string[]>;
}

function clientInputFromFormData(formData: FormData): Record<string, unknown> {
  return {
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    company: formData.get("company"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    whatsapp: formData.get("whatsapp"),
    taxId: formData.get("taxId"),
    website: formData.get("website"),
    address: formData.get("address"),
    notes: formData.get("notes"),
    status: formData.get("status") || undefined,
  };
}

function validationError(
  issues: ReturnType<typeof clientFormSchema.safeParse> & { success: false },
): ClientActionState {
  return {
    status: "error",
    message: "Revisá los campos indicados.",
    fieldErrors: issues.error.flatten().fieldErrors,
  };
}

function revalidateClientPaths(id: string) {
  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
}

export async function createClientAction(
  _previousState: ClientActionState,
  formData: FormData,
): Promise<ClientActionState> {
  const user = await requireUser();
  const parsed = clientFormSchema.safeParse(clientInputFromFormData(formData));
  if (!parsed.success) return validationError(parsed);

  try {
    const id = await withAuthenticatedDb(user.id, async (db) => {
      const [created] = await db
        .insert(clients)
        .values({ ...parsed.data, ownerId: user.id })
        .returning({ id: clients.id });
      return created?.id;
    });

    if (!id) {
      return { status: "error", message: "No pudimos crear el cliente." };
    }

    revalidateClientPaths(id);
    return { status: "success", clientId: id };
  } catch {
    return { status: "error", message: "No pudimos crear el cliente." };
  }
}

export async function updateClientAction(
  _previousState: ClientActionState,
  formData: FormData,
): Promise<ClientActionState> {
  const user = await requireUser();
  const idResult = clientIdSchema.safeParse(formData.get("id"));
  const clientResult = clientFormSchema.safeParse(
    clientInputFromFormData(formData),
  );

  if (!idResult.success) {
    return { status: "error", message: "El cliente no es válido." };
  }
  if (!clientResult.success) return validationError(clientResult);

  try {
    const updated = await withAuthenticatedDb(user.id, async (db) => {
      return db
        .update(clients)
        .set({
          ...(clientResult.data as ClientFormValues),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(clients.id, idResult.data),
            eq(clients.ownerId, user.id),
          ),
        )
        .returning({ id: clients.id });
    });

    if (!updated[0]) {
      return {
        status: "error",
        message: "No pudimos actualizar el cliente.",
      };
    }

    revalidateClientPaths(idResult.data);
    return { status: "success", clientId: idResult.data };
  } catch {
    return { status: "error", message: "No pudimos actualizar el cliente." };
  }
}

export async function archiveClientAction(
  _previousState: ClientActionState,
  formData: FormData,
): Promise<ClientActionState> {
  const user = await requireUser();
  const idResult = clientIdSchema.safeParse(formData.get("id"));
  if (!idResult.success) {
    return { status: "error", message: "El cliente no es válido." };
  }

  try {
    const archived = await withAuthenticatedDb(user.id, async (db) => {
      return db
        .update(clients)
        .set({ status: "archived", updatedAt: new Date() })
        .where(
          and(
            eq(clients.id, idResult.data),
            eq(clients.ownerId, user.id),
          ),
        )
        .returning({ id: clients.id });
    });

    if (!archived[0]) {
      return { status: "error", message: "No pudimos archivar el cliente." };
    }

    revalidateClientPaths(idResult.data);
    return { status: "success", clientId: idResult.data };
  } catch {
    return { status: "error", message: "No pudimos archivar el cliente." };
  }
}
