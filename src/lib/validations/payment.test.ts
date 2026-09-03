import { describe, expect, it } from "vitest";

import { paymentFormSchema } from "./payment";

describe("payment validation", () => {
  const base = { chargeId: "11111111-1111-4111-8111-111111111111", clientId: "22222222-2222-4222-8222-222222222222", amount: "500,00", currency: "ARS", paymentDate: "2026-08-31", paymentMethod: "bank_transfer", reference: " OP-7 ", notes: "" };

  it("parses money, optional text and explicit overpay confirmation", () => {
    expect(paymentFormSchema.parse({ ...base, confirmOverpay: "on" })).toMatchObject({ amountMinor: 50000, confirmOverpay: true, reference: "OP-7", notes: null });
  });

  it("defaults confirmation to false and rejects invalid dates and methods", () => {
    expect(paymentFormSchema.parse(base).confirmOverpay).toBe(false);
    expect(paymentFormSchema.safeParse({ ...base, paymentDate: "2026-02-30" }).success).toBe(false);
    expect(paymentFormSchema.safeParse({ ...base, paymentMethod: "card" }).success).toBe(false);
  });

  it.each(["debit_card", "credit_card"])(
    "accepts the added %s method without dropping existing methods",
    (paymentMethod) => {
      expect(paymentFormSchema.parse({ ...base, paymentMethod }).paymentMethod)
        .toBe(paymentMethod);
    },
  );

  it.each([
    "bank_transfer",
    "cash",
    "mercadopago",
    "paypal",
    "payoneer",
    "stripe",
    "crypto",
    "other",
  ])("continues to accept %s", (paymentMethod) => {
    expect(paymentFormSchema.safeParse({ ...base, paymentMethod }).success)
      .toBe(true);
  });
});
