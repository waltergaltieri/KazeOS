"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";

import { planDueLeadHunterRuns, withAuthenticatedDb } from "@/db";
import { requireUser } from "@/lib/auth/require-user";
import { createCampaign } from "@/lib/services/leadhunter/campaign-manager";
import { createLead } from "@/lib/services/leadhunter/lead-manager";
import { controlCampaign } from "@/lib/services/leadhunter/campaign-control";
import {
  campaignFormSchema,
  campaignIdSchema,
  leadFormSchema,
} from "@/lib/validations/leadhunter";

export interface LeadHunterActionState {
  status: "idle" | "error" | "success";
  message?: string;
  campaignId?: string;
  leadId?: string;
  fieldErrors?: Record<string, string[]>;
}

function lines(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function strings(values: FormDataEntryValue[]): string[] {
  return values.filter((value): value is string => typeof value === "string");
}

function parseSequence(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function campaignInput(formData: FormData): Record<string, unknown> {
  return {
    name: formData.get("name"),
    objective: formData.get("objective"),
    serviceFocus: formData.get("serviceFocus"),
    countries: strings(formData.getAll("countries")),
    sources: strings(formData.getAll("sources")),
    positiveCriteria: lines(formData.get("positiveCriteria")),
    negativeCriteria: lines(formData.get("negativeCriteria")),
    searchDays: strings(formData.getAll("searchDays")),
    searchTime: formData.get("searchTime"),
    sendDays: strings(formData.getAll("sendDays")),
    sendStart: formData.get("sendStart"),
    sendEnd: formData.get("sendEnd"),
    timezone: formData.get("timezone"),
    dailyLeadLimit: formData.get("dailyLeadLimit"),
    dailyEmailLimit: formData.get("dailyEmailLimit"),
    sequenceSteps: parseSequence(formData.get("sequenceSteps")),
    messageLanguage: formData.get("messageLanguage"),
    messageCta: formData.get("messageCta"),
    messageSignature: formData.get("messageSignature"),
    restrictedPhrases: lines(formData.get("restrictedPhrases")),
  };
}

function validationError(error: ZodError): LeadHunterActionState {
  const flattened = error.flatten();
  return {
    status: "error",
    message: "Revisá los campos indicados.",
    fieldErrors: flattened.fieldErrors as Record<string, string[]>,
  };
}

function leadInput(formData: FormData): Record<string, unknown> {
  return {
    campaignId: formData.get("campaignId"),
    name: formData.get("name"),
    countryCode: formData.get("countryCode"),
    city: formData.get("city"),
    website: formData.get("website"),
    description: formData.get("description"),
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    role: formData.get("role"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    sourceType: formData.get("sourceType") || "manual",
    sourceUrl: formData.get("sourceUrl"),
  };
}

export async function createLeadHunterCampaignAction(
  _previousState: LeadHunterActionState,
  formData: FormData,
): Promise<LeadHunterActionState> {
  const sequenceValue = formData.get("sequenceSteps");
  const sequenceSteps = parseSequence(sequenceValue);
  if (sequenceSteps === undefined) {
    return { status: "error", message: "Revisá la secuencia de correos." };
  }

  const parsed = campaignFormSchema.safeParse({
    ...campaignInput(formData),
    sequenceSteps,
  });
  if (!parsed.success) return validationError(parsed.error);

  const user = await requireUser();
  try {
    const campaignId = await withAuthenticatedDb(user.id, (database) =>
      createCampaign(database, user.id, parsed.data),
    );
    revalidatePath("/leadhunter");
    revalidatePath(`/leadhunter/campaigns/${campaignId}`);
    return { status: "success", campaignId };
  } catch {
    return { status: "error", message: "No pudimos crear la campaña." };
  }
}

export async function createLeadHunterLeadAction(
  _previousState: LeadHunterActionState,
  formData: FormData,
): Promise<LeadHunterActionState> {
  const parsed = leadFormSchema.safeParse(leadInput(formData));
  if (!parsed.success) return validationError(parsed.error);

  const user = await requireUser();
  try {
    const leadId = await withAuthenticatedDb(user.id, (database) =>
      createLead(database, user.id, parsed.data),
    );
    revalidatePath("/leadhunter");
    revalidatePath(`/leadhunter/campaigns/${parsed.data.campaignId}`);
    revalidatePath(`/leadhunter/leads/${leadId}`);
    return {
      status: "success",
      leadId,
      campaignId: parsed.data.campaignId,
    };
  } catch {
    return { status: "error", message: "No pudimos crear el prospecto." };
  }
}

export async function controlLeadHunterCampaignAction(formData: FormData): Promise<void> {
  const campaignId = campaignIdSchema.parse(formData.get("campaignId"));
  const command = formData.get("command");
  if (command !== "activate" && command !== "pause" && command !== "run_now") throw new Error("Acción inválida");
  const user = await requireUser();
  await withAuthenticatedDb(user.id, (database) => controlCampaign(database, { ownerId: user.id, campaignId, command }));
  if (command !== "pause") await planDueLeadHunterRuns();
  revalidatePath("/leadhunter");
  revalidatePath(`/leadhunter/campaigns/${campaignId}`);
}
