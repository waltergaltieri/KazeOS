import { describe, expect, it } from "vitest";

import { chargeFiltersSchema, chargeFormSchema } from "./charge";

describe("charge validation", () => {
  it("normalizes a valid manual charge", () => {
    expect(chargeFormSchema.parse({
      clientId: "11111111-1111-4111-8111-111111111111",
      description: "  Implementación  ", amount: "1.250,50", currency: "USD",
      dueDate: "2026-09-15", notes: "",
    })).toEqual({ clientId: "11111111-1111-4111-8111-111111111111", description: "Implementación", amountMinor: 125050, currency: "USD", dueDate: "2026-09-15", notes: null });
  });

  it.each(["0", "-1", "90071992547409,92"])("rejects unsafe amount %s", (amount) => {
    expect(chargeFormSchema.safeParse({ clientId: "11111111-1111-4111-8111-111111111111", description: "Cargo", amount, currency: "ARS", dueDate: "2026-09-15", notes: "" }).success).toBe(false);
  });

  it("validates and normalizes the complete filter contract", () => {
    expect(chargeFiltersSchema.parse({ status: "overdue", clientId: "11111111-1111-4111-8111-111111111111", currency: "USD", serviceId: "", from: "2026-09-01", to: "2026-09-30", search: "  norte " })).toEqual({ status: "overdue", clientId: "11111111-1111-4111-8111-111111111111", currency: "USD", serviceId: undefined, from: "2026-09-01", to: "2026-09-30", search: "norte" });
  });
});
