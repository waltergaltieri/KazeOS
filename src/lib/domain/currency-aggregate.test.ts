import { describe, expect, it } from "vitest";

import {
  aggregateByCurrency,
  calculateExpensesByCurrency,
  subtractAggregate,
  zeroByCurrency,
} from "./currency-aggregate";

describe("currency aggregates", () => {
  it("initializes every supported currency at zero", () => {
    expect(zeroByCurrency()).toEqual({ USD: "0", ARS: "0" });
  });

  it("adds integer minor-unit strings without mixing currencies", () => {
    expect(
      aggregateByCurrency([
        { amountMinor: "200000", currency: "USD" },
        { amountMinor: "80000", currency: "USD" },
        { amountMinor: "50000000", currency: "ARS" },
      ]),
    ).toEqual({ USD: "280000", ARS: "50000000" });
  });

  it("keeps exact values above Number.MAX_SAFE_INTEGER", () => {
    const aboveSafeInteger = (
      BigInt(Number.MAX_SAFE_INTEGER) + BigInt(10)
    ).toString() as `${bigint}`;

    expect(
      aggregateByCurrency([
        { amountMinor: aboveSafeInteger, currency: "USD" },
        { amountMinor: "9", currency: "USD" },
      ]),
    ).toEqual({
      USD: (BigInt(aboveSafeInteger) + BigInt(9)).toString(),
      ARS: "0",
    });
  });

  it.each(["", "1.5", "01", "+1", " 1", "1 "])(
    "rejects a noncanonical integer string %j",
    (amountMinor) => {
      expect(() =>
        aggregateByCurrency([
          { amountMinor: amountMinor as `${bigint}`, currency: "USD" },
        ]),
      ).toThrow(RangeError);
    },
  );

  it("delegates expense aggregation to the currency-safe operation", () => {
    expect(
      calculateExpensesByCurrency([
        { amountMinor: "100", currency: "ARS" },
        { amountMinor: "25", currency: "ARS" },
      ]),
    ).toEqual({ USD: "0", ARS: "125" });
  });

  it("subtracts aggregate strings exactly and supports negative results", () => {
    expect(subtractAggregate("9007199254741001", "9")).toBe(
      "9007199254740992",
    );
    expect(subtractAggregate("25", "100")).toBe("-75");
  });
});
