"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";

import { withAuthenticatedDb } from "@/db";
import { profiles, settings } from "@/db/schema";
import { requireUser } from "@/lib/auth/require-user";
import { businessSettingsSchema, profileSettingsSchema } from "@/lib/validations/settings";

export interface SettingsActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

const invalid = (error: ZodError): SettingsActionState => ({ status: "error", message: "Revisá los campos indicados.", fieldErrors: error.flatten().fieldErrors });

export async function updateProfileSettingsAction(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const parsed = profileSettingsSchema.safeParse({ fullName: formData.get("fullName") });
  if (!parsed.success) return invalid(parsed.error);
  const user = await requireUser();
  const email = user.email;
  if (!email) return { status: "error", message: "La cuenta autenticada no tiene email." };
  try {
    await withAuthenticatedDb(user.id, (database) => database.insert(profiles).values({ id: user.id, fullName: parsed.data.fullName, email }).onConflictDoUpdate({ target: profiles.id, set: { fullName: parsed.data.fullName, email, updatedAt: new Date() } }));
    revalidatePath("/settings");
    return { status: "success", message: "Perfil actualizado." };
  } catch {
    return { status: "error", message: "No pudimos actualizar el perfil." };
  }
}

export async function updateBusinessSettingsAction(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const parsed = businessSettingsSchema.safeParse({
    primaryCurrency: formData.get("primaryCurrency"), timezone: formData.get("timezone"), locale: formData.get("locale"), businessName: formData.get("businessName"), businessInfo: formData.get("businessInfo"),
  });
  if (!parsed.success) return invalid(parsed.error);
  const user = await requireUser();
  try {
    await withAuthenticatedDb(user.id, (database) => database.insert(settings).values({ ownerId: user.id, ...parsed.data }).onConflictDoUpdate({ target: settings.ownerId, set: { ...parsed.data, updatedAt: new Date() } }));
    revalidatePath("/settings");
    revalidatePath("/dashboard");
    return { status: "success", message: "Preferencias guardadas." };
  } catch {
    return { status: "error", message: "No pudimos guardar las preferencias." };
  }
}
