import { z } from "zod";

import { validateCommercialDate } from "@/lib/domain/commercial-date";
import { parseMoneyInput } from "@/lib/domain/money";

const optionalText = (max: number) =>
  z.preprocess(
    (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value !== "string") return value;
      const normalized = value.trim();
      return normalized.length === 0 ? null : normalized;
    },
    z.string().max(max).nullable(),
  );

const commercialDate = z.string().superRefine((value, context) => {
  try {
    validateCommercialDate(value);
  } catch {
    context.addIssue({
      code: "custom",
      message: "Ingresá una fecha válida.",
    });
  }
});

const optionalCommercialDate = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") return value;
    const normalized = value.trim();
    return normalized.length === 0 ? null : normalized;
  },
  commercialDate.nullable(),
);

const amount = z.string().trim().superRefine((value, context) => {
  try {
    if (parseMoneyInput(value) <= 0) throw new RangeError();
  } catch {
    context.addIssue({
      code: "custom",
      message: "Ingresá un monto positivo válido.",
    });
  }
}).transform((value) => parseMoneyInput(value));

const billingDay = z.preprocess(
  (value) => {
    if (value === null || value === undefined || value === "") return null;
    return typeof value === "string" ? Number(value) : value;
  },
  z.number().int().min(1).max(31).nullable(),
);

const checkbox = z.preprocess(
  (value) => value === "on" || value === "true" || value === true,
  z.boolean(),
);

export const serviceIdSchema = z.string().uuid("El servicio no es válido.");
export const serviceCurrencySchema = z.enum(["USD", "ARS"]);
export const serviceBillingTypeSchema = z.enum(["recurring", "one_time"]);
export const serviceBillingFrequencySchema = z.enum([
  "monthly",
  "quarterly",
  "yearly",
  "one_time",
]);
export const serviceStatusSchema = z.enum(["active", "paused", "cancelled"]);

export const serviceFormSchema = z
  .object({
    name: z.string().trim().min(1, "El nombre es obligatorio.").max(200),
    description: optionalText(2_000),
    amount,
    currency: serviceCurrencySchema,
    billingType: serviceBillingTypeSchema,
    billingFrequency: serviceBillingFrequencySchema,
    billingDay,
    startDate: commercialDate,
    endDate: optionalCommercialDate,
    status: serviceStatusSchema.default("active"),
    automaticChargeGeneration: checkbox,
  })
  .strict()
  .superRefine((service, context) => {
    const recurring = service.billingType === "recurring";

    if (
      (recurring &&
        (service.billingFrequency === "one_time" || service.billingDay === null)) ||
      (!recurring &&
        (service.billingFrequency !== "one_time" || service.billingDay !== null))
    ) {
      context.addIssue({
        code: "custom",
        path: ["billingFrequency"],
        message: "La modalidad y la frecuencia no coinciden.",
      });
    }

    if (!recurring && service.automaticChargeGeneration) {
      context.addIssue({
        code: "custom",
        path: ["automaticChargeGeneration"],
        message: "La generación automática requiere un servicio recurrente.",
      });
    }

    if (
      service.endDate !== null &&
      service.startDate.localeCompare(service.endDate) > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "La fecha de fin no puede ser anterior al inicio.",
      });
    }
  })
  .transform(({ amount: amountMinor, ...service }) => ({
    ...service,
    amountMinor,
  }));

export type ServiceFormValues = z.infer<typeof serviceFormSchema>;
