import { describe, expect, it } from "vitest";

import {
  parseCurrencyPreference,
  resolveCurrencyPreference,
} from "./currency";

describe("currency preference", () => {
  it.each([
    ["USD", "USD"],
    ["ARS", "ARS"],
    ["EUR", undefined],
    [undefined, undefined],
    [["ARS"], undefined],
  ])("parses %j strictly", (value, expected) => {
    expect(parseCurrencyPreference(value)).toBe(expected);
  });

  it("prefers a valid URL value over the remembered currency", () => {
    expect(resolveCurrencyPreference("USD", "ARS")).toBe("USD");
  });

  it("uses the remembered currency when the URL value is missing or invalid", () => {
    expect(resolveCurrencyPreference(undefined, "ARS")).toBe("ARS");
    expect(resolveCurrencyPreference("EUR", "ARS")).toBe("ARS");
  });

  it("falls back to USD when neither value is valid", () => {
    expect(resolveCurrencyPreference(undefined, undefined)).toBe("USD");
    expect(resolveCurrencyPreference("EUR", "BRL")).toBe("USD");
  });
});
