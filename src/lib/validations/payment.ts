import { z } from "zod";

import { parseMoneyInput } from "@/lib/domain/money";
import { chargeCurrencySchema, chargeIdSchema, commercialDateSchema } from "./charge";

const optionalText = (max: number) => z.preprocess((value) => {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  return normalized || null;
}, z.string().max(max).nullable());
const positiveMoney = z.string().trim().superRefine((value, context) => {
  try { if (parseMoneyInput(value) <= 0) throw new RangeError(); } catch { context.addIssue({ code: "custom", message: "Ingresá un monto positivo válido." }); }
}).transform((value) => parseMoneyInput(value));
const checkbox = z.preprocess((value) => value === true || value === "true" || value === "on", z.boolean());

export const paymentIdSchema = z.string().uuid("El pago no es válido.");
export const paymentMethodSchema = z.enum(["bank_transfer", "cash", "mercadopago", "paypal", "payoneer", "stripe", "crypto", "other", "debit_card", "credit_card"]);
export const paymentFormSchema = z.object({
  chargeId: chargeIdSchema,
  clientId: z.string().uuid("El cliente no es válido."),
  amount: positiveMoney,
  currency: chargeCurrencySchema,
  paymentDate: commercialDateSchema,
  paymentMethod: paymentMethodSchema,
  reference: optionalText(200),
  notes: optionalText(2_000),
  confirmOverpay: checkbox.default(false),
}).strict().transform(({ amount: amountMinor, ...values }) => ({ ...values, amountMinor }));

export const paymentCorrectionSchema = paymentFormSchema.and(z.object({ paymentId: paymentIdSchema }));
export type PaymentFormValues = z.infer<typeof paymentFormSchema>;
