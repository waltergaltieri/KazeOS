import { describe, expect, it } from "vitest";

import { formatMoney, parseMoneyInput } from "./money";

describe("formatMoney", () => {
  it("formats USD minor units for es-AR without losing the currency code", () => {
    expect(formatMoney(125_000, "USD")).toMatch(/^USD\s?1\.250,00$/u);
  });

  it("rejects a non-integer minor-unit amount", () => {
    expect(() => formatMoney(10.5, "ARS")).toThrow(RangeError);
  });

  it("formats ARS, zero, and negative presentation values", () => {
    expect(formatMoney(85_000_000, "ARS")).toMatch(
      /^ARS\s?850\.000,00$/u,
    );
    expect(formatMoney(0, "USD")).toMatch(/^USD\s?0,00$/u);
    expect(formatMoney(-1_250, "ARS")).toMatch(/^ARS\s?-12,50$/u);
  });

  it("rejects unsafe minor-unit amounts", () => {
    expect(() =>
      formatMoney(Number.MAX_SAFE_INTEGER + 1, "USD"),
    ).toThrow(RangeError);
  });
});

describe("parseMoneyInput", () => {
  it("parses an Argentine grouped decimal amount into minor units", () => {
    expect(parseMoneyInput("1.250,50")).toBe(125_050);
  });

  it("parses an ungrouped API-style decimal amount", () => {
    expect(parseMoneyInput("1250.50")).toBe(125_050);
  });

  it("rejects amounts above the safe integer range in minor units", () => {
    expect(() => parseMoneyInput("90071992547409.92")).toThrow(RangeError);
  });

  it("parses a negative amount only when explicitly allowed", () => {
    expect(parseMoneyInput("-1250,50", { allowNegative: true })).toBe(
      -125_050,
    );
  });

  it("parses ungrouped Argentine amounts and pads a single decimal digit", () => {
    expect(parseMoneyInput("1250,50")).toBe(125_050);
    expect(parseMoneyInput("1250,5")).toBe(125_050);
    expect(parseMoneyInput("1250")).toBe(125_000);
  });

  it("treats a lone dot after a nonzero prefix as Argentine grouping", () => {
    expect(parseMoneyInput("1.000")).toBe(100_000);
    expect(parseMoneyInput("1.250")).toBe(125_000);
    expect(parseMoneyInput("1.250.000")).toBe(125_000_000);
  });

  it.each([
    "0.000",
    "0.001",
    "0.001,50",
    "00.001",
    "000.001",
    "01.000",
    "00.001,50",
  ])(
    "rejects noncanonical leading-zero grouping %j",
    (input) => {
      expect(() => parseMoneyInput(input)).toThrow(RangeError);
    },
  );

  it("accepts the largest safe amount in minor units exactly", () => {
    expect(parseMoneyInput("90071992547409.91")).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(parseMoneyInput("90.071.992.547.409,91")).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("rejects negative amounts by default", () => {
    expect(() => parseMoneyInput("-1,00")).toThrow(RangeError);
  });

  it("rejects oversized input before numeric conversion", () => {
    expect(() => parseMoneyInput("9".repeat(100_000))).toThrow(
      "Money amount input is too long",
    );
    expect(() => parseMoneyInput("900719925474099")).toThrow(
      "Money amount input is too long",
    );
  });

  it.each([
    "",
    "   ",
    "1,234",
    "1250.1234",
    "12.34,50",
    "1,250.50",
    "1.250.50",
    "1 250,50",
    "ARS 1250",
    "amount",
  ])("rejects malformed money input %j", (input) => {
    expect(() => parseMoneyInput(input)).toThrow(RangeError);
  });
});
