import { describe, expect, it } from "vitest";

import { calculateMrr, type MrrServiceInput } from "./mrr";

function service(
  overrides: Partial<MrrServiceInput> = {},
): MrrServiceInput {
  return {
    amountMinor: 60_000,
    billingFrequency: "monthly",
    billingType: "recurring",
    currency: "USD",
    status: "active",
    ...overrides,
  };
}

describe("calculateMrr", () => {
  it("groups active monthly recurring revenue by currency", () => {
    expect(
      calculateMrr([
        service(),
        service({ amountMinor: 85_000_000, currency: "ARS" }),
      ]),
    ).toEqual({ USD: 60_000, ARS: 85_000_000 });
  });

  it.each(["paused", "cancelled"] as const)(
    "excludes %s services",
    (status) => {
      expect(calculateMrr([service({ status })])).toEqual({ USD: 0, ARS: 0 });
    },
  );

  it("excludes services when either billing dimension is one-time", () => {
    expect(
      calculateMrr([
        service({ billingType: "one_time" }),
        service({ billingFrequency: "one_time" }),
      ]),
    ).toEqual({ USD: 0, ARS: 0 });
  });

  it("normalizes quarterly and yearly services to monthly minor units", () => {
    expect(
      calculateMrr([
        service({ amountMinor: 300, billingFrequency: "quarterly" }),
        service({ amountMinor: 1_200, billingFrequency: "yearly" }),
      ]),
    ).toEqual({ USD: 200, ARS: 0 });
  });

  it("rounds each fractional monthly amount to the nearest minor unit with halves up", () => {
    expect(
      calculateMrr([
        service({ amountMinor: 100, billingFrequency: "quarterly" }),
        service({ amountMinor: 5, billingFrequency: "yearly" }),
        service({ amountMinor: 6, billingFrequency: "yearly" }),
      ]),
    ).toEqual({ USD: 34, ARS: 0 });
  });

  it("returns explicit zeroes for missing currencies", () => {
    expect(calculateMrr([])).toEqual({ USD: 0, ARS: 0 });
    expect(calculateMrr([service()])).toEqual({ USD: 60_000, ARS: 0 });
  });

  it("does not mutate the service list or its entries", () => {
    const entry = Object.freeze(service({ billingFrequency: "quarterly" }));
    const input = Object.freeze([entry]);
    const snapshot = { ...entry };

    calculateMrr(input);

    expect(entry).toEqual(snapshot);
    expect(input).toEqual([entry]);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid service amounts: %s",
    (amountMinor) => {
      expect(() => calculateMrr([service({ amountMinor })])).toThrow(
        RangeError,
      );
    },
  );

  it.each([
    { billingType: "metered" },
    { billingFrequency: "weekly" },
    { currency: "EUR" },
    { status: "archived" },
  ])("rejects invalid enum-like input $billingType$billingFrequency$currency$status", (override) => {
    expect(() => calculateMrr([service(override as never)])).toThrow(
      RangeError,
    );
  });

  it("accepts the maximum safe monthly amount", () => {
    expect(
      calculateMrr([service({ amountMinor: Number.MAX_SAFE_INTEGER })]),
    ).toEqual({ USD: Number.MAX_SAFE_INTEGER, ARS: 0 });
  });

  it("rejects a grouped result beyond the safe integer boundary", () => {
    expect(() =>
      calculateMrr([
        service({ amountMinor: Number.MAX_SAFE_INTEGER }),
        service({ amountMinor: 1 }),
      ]),
    ).toThrow(RangeError);
  });

  it("validates excluded entries instead of hiding malformed data", () => {
    expect(() =>
      calculateMrr([
        service({ amountMinor: Number.NaN, status: "cancelled" }),
      ]),
    ).toThrow(RangeError);
  });
});
