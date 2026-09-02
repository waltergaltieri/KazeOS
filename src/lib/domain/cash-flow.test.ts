import { describe, expect, it } from "vitest";

import { calculateMonthlyCashFlow } from "./cash-flow";

describe("calculateMonthlyCashFlow", () => {
  it("returns projected and actual results independently for each currency", () => {
    expect(
      calculateMonthlyCashFlow({
        projectedIncome: { USD: "200000", ARS: "0" },
        actualIncome: { USD: "140000", ARS: "0" },
        projectedExpenses: { USD: "80000", ARS: "0" },
        actualExpenses: { USD: "50000", ARS: "0" },
      }),
    ).toEqual({
      USD: {
        projectedIncome: "200000",
        actualIncome: "140000",
        projectedExpenses: "80000",
        actualExpenses: "50000",
        projectedNet: "120000",
        actualNet: "90000",
      },
      ARS: {
        projectedIncome: "0",
        actualIncome: "0",
        projectedExpenses: "0",
        actualExpenses: "0",
        projectedNet: "0",
        actualNet: "0",
      },
    });
  });

  it("calculates both currencies exactly beyond Number.MAX_SAFE_INTEGER", () => {
    const large = (
      BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1000)
    ).toString() as `${bigint}`;

    expect(
      calculateMonthlyCashFlow({
        projectedIncome: { USD: large, ARS: "500" },
        actualIncome: { USD: "0", ARS: large },
        projectedExpenses: { USD: "1", ARS: "700" },
        actualExpenses: { USD: "2", ARS: "3" },
      }),
    ).toEqual({
      USD: {
        projectedIncome: large,
        actualIncome: "0",
        projectedExpenses: "1",
        actualExpenses: "2",
        projectedNet: (BigInt(large) - BigInt(1)).toString(),
        actualNet: "-2",
      },
      ARS: {
        projectedIncome: "500",
        actualIncome: large,
        projectedExpenses: "700",
        actualExpenses: "3",
        projectedNet: "-200",
        actualNet: (BigInt(large) - BigInt(3)).toString(),
      },
    });
  });

  it("rejects invalid aggregate strings instead of coercing them", () => {
    expect(() =>
      calculateMonthlyCashFlow({
        projectedIncome: { USD: "1.5" as `${bigint}`, ARS: "0" },
        actualIncome: { USD: "0", ARS: "0" },
        projectedExpenses: { USD: "0", ARS: "0" },
        actualExpenses: { USD: "0", ARS: "0" },
      }),
    ).toThrow(RangeError);
  });

  it("rejects negative zero instead of preserving a noncanonical aggregate", () => {
    expect(() =>
      calculateMonthlyCashFlow({
        projectedIncome: { USD: "0", ARS: "0" },
        actualIncome: { USD: "-0", ARS: "0" },
        projectedExpenses: { USD: "0", ARS: "0" },
        actualExpenses: { USD: "0", ARS: "0" },
      }),
    ).toThrow(RangeError);
  });
});
