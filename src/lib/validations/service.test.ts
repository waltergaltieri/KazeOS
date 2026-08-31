import { describe, expect, it } from "vitest";

import { serviceFormSchema } from "./service";

const recurringService = {
  name: " Mantenimiento mensual ",
  description: " Soporte y mejoras ",
  amount: "1.250,50",
  currency: "USD",
  billingType: "recurring",
  billingFrequency: "monthly",
  billingDay: "31",
  startDate: "2026-08-31",
  endDate: "",
  status: "active",
  automaticChargeGeneration: "on",
};

describe("serviceFormSchema", () => {
  it("normalizes a recurring agreement and parses money exactly", () => {
    expect(serviceFormSchema.parse(recurringService)).toEqual({
      name: "Mantenimiento mensual",
      description: "Soporte y mejoras",
      amountMinor: 125_050,
      currency: "USD",
      billingType: "recurring",
      billingFrequency: "monthly",
      billingDay: 31,
      startDate: "2026-08-31",
      endDate: null,
      status: "active",
      automaticChargeGeneration: true,
    });
  });

  it.each(["0", "-1", "hola", "90071992547409,92"])(
    "rejects a non-positive, malformed, or unsafe amount: %s",
    (amount) => {
      expect(
        serviceFormSchema.safeParse({ ...recurringService, amount }).success,
      ).toBe(false);
    },
  );

  it("constrains currencies, frequencies, and statuses", () => {
    for (const patch of [
      { currency: "EUR" },
      { billingFrequency: "weekly" },
      { status: "deleted" },
    ]) {
      expect(
        serviceFormSchema.safeParse({ ...recurringService, ...patch }).success,
      ).toBe(false);
    }
  });

  it("requires billing day 1 through 31 for recurring services", () => {
    for (const billingDay of ["", "0", "32", "1.5"]) {
      expect(
        serviceFormSchema.safeParse({ ...recurringService, billingDay }).success,
      ).toBe(false);
    }
  });

  it("coheres one-time billing and disables automatic generation", () => {
    expect(
      serviceFormSchema.parse({
        ...recurringService,
        billingType: "one_time",
        billingFrequency: "one_time",
        billingDay: "",
        automaticChargeGeneration: undefined,
      }),
    ).toMatchObject({
      billingType: "one_time",
      billingFrequency: "one_time",
      billingDay: null,
      automaticChargeGeneration: false,
    });

    expect(
      serviceFormSchema.safeParse({
        ...recurringService,
        billingType: "one_time",
      }).success,
    ).toBe(false);
    expect(
      serviceFormSchema.safeParse({
        ...recurringService,
        billingFrequency: "one_time",
      }).success,
    ).toBe(false);
  });

  it("requires strict commercial dates and end on or after start", () => {
    for (const patch of [
      { startDate: "" },
      { startDate: "2026-02-30" },
      { startDate: "31/08/2026" },
      { endDate: "2026-02-30" },
      { endDate: "2026-08-30" },
    ]) {
      expect(
        serviceFormSchema.safeParse({ ...recurringService, ...patch }).success,
      ).toBe(false);
    }
  });
});
