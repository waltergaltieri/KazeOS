"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";

import { withAuthenticatedDb } from "@/db";
import { todayInBusinessZone } from "@/lib/domain/commercial-date";
import { requireUser } from "@/lib/auth/require-user";
import {
  createServiceWithCharges,
  deactivateServiceWithCharges,
  ServiceCurrencyLockedError,
  updateServiceWithCharges,
} from "@/lib/services/service-manager";
import { clientIdSchema } from "@/lib/validations/client";
import {
  serviceFormSchema,
  serviceIdSchema,
} from "@/lib/validations/service";

export interface ServiceActionState {
  status: "idle" | "error" | "success";
  message?: string;
  clientId?: string;
  serviceId?: string;
  fieldErrors?: Record<string, string[]>;
}

function serviceInputFromFormData(formData: FormData) {
  return {
    name: formData.get("name"),
    description: formData.get("description"),
    amount: formData.get("amount"),
    currency: formData.get("currency"),
    billingType: formData.get("billingType"),
    billingFrequency: formData.get("billingFrequency"),
    billingDay: formData.get("billingDay"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    status: formData.get("status") || undefined,
    automaticChargeGeneration: formData.get("automaticChargeGeneration"),
  };
}

function validationError(issues: { error: ZodError }): ServiceActionState {
  return {
    status: "error",
    message: "Revisá los campos indicados.",
    fieldErrors: issues.error.flatten().fieldErrors,
  };
}

function revalidateServicePaths(clientId: string, serviceId?: string) {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/services`);
  if (serviceId) revalidatePath(`/clients/${clientId}/services/${serviceId}/edit`);
}

function currencyLockedError(): ServiceActionState {
  return {
    status: "error",
    message: "La moneda no puede cambiar porque el servicio ya tiene cargos.",
    fieldErrors: {
      currency: ["Conservá la moneda original para proteger el historial."],
    },
  };
}

export async function createServiceAction(
  _previousState: ServiceActionState,
  formData: FormData,
): Promise<ServiceActionState> {
  const user = await requireUser();
  const clientResult = clientIdSchema.safeParse(formData.get("clientId"));
  const serviceResult = serviceFormSchema.safeParse(
    serviceInputFromFormData(formData),
  );

  if (!clientResult.success) {
    return { status: "error", message: "El cliente no es válido." };
  }
  if (!serviceResult.success) return validationError(serviceResult);

  try {
    const result = await withAuthenticatedDb(user.id, (database) =>
      createServiceWithCharges(database, {
        asOf: todayInBusinessZone(new Date()),
        clientId: clientResult.data,
        ownerId: user.id,
        values: serviceResult.data,
      }),
    );

    revalidateServicePaths(clientResult.data, result.id);
    return {
      status: "success",
      clientId: clientResult.data,
      serviceId: result.id,
    };
  } catch {
    return { status: "error", message: "No pudimos crear el servicio." };
  }
}

export async function updateServiceAction(
  _previousState: ServiceActionState,
  formData: FormData,
): Promise<ServiceActionState> {
  const user = await requireUser();
  const clientResult = clientIdSchema.safeParse(formData.get("clientId"));
  const idResult = serviceIdSchema.safeParse(formData.get("serviceId"));
  const serviceResult = serviceFormSchema.safeParse(
    serviceInputFromFormData(formData),
  );

  if (!clientResult.success || !idResult.success) {
    return { status: "error", message: "El servicio no es válido." };
  }
  if (!serviceResult.success) return validationError(serviceResult);

  try {
    const result = await withAuthenticatedDb(user.id, (database) =>
      updateServiceWithCharges(database, {
        asOf: todayInBusinessZone(new Date()),
        clientId: clientResult.data,
        ownerId: user.id,
        serviceId: idResult.data,
        values: serviceResult.data,
      }),
    );

    revalidateServicePaths(clientResult.data, result.id);
    return {
      status: "success",
      clientId: clientResult.data,
      serviceId: result.id,
    };
  } catch (error) {
    if (error instanceof ServiceCurrencyLockedError) return currencyLockedError();
    return { status: "error", message: "No pudimos actualizar el servicio." };
  }
}

export async function deactivateServiceAction(
  _previousState: ServiceActionState,
  formData: FormData,
): Promise<ServiceActionState> {
  const user = await requireUser();
  const clientResult = clientIdSchema.safeParse(formData.get("clientId"));
  const idResult = serviceIdSchema.safeParse(formData.get("serviceId"));

  if (!clientResult.success || !idResult.success) {
    return { status: "error", message: "El servicio no es válido." };
  }

  try {
    const result = await withAuthenticatedDb(user.id, (database) =>
      deactivateServiceWithCharges(database, {
        asOf: todayInBusinessZone(new Date()),
        clientId: clientResult.data,
        ownerId: user.id,
        serviceId: idResult.data,
        status: "paused",
      }),
    );

    revalidateServicePaths(clientResult.data, result.id);
    return {
      status: "success",
      clientId: clientResult.data,
      serviceId: result.id,
    };
  } catch {
    return { status: "error", message: "No pudimos pausar el servicio." };
  }
}
