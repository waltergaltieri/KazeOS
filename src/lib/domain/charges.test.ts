import { describe, expect, it } from "vitest";

import {
  getChargeBalance,
  getChargeOverpayment,
  getChargeStatus,
  type ChargeStatusInput,
} from "./charges";

const today = "2026-08-31";

function charge(
  overrides: Partial<ChargeStatusInput> = {},
): ChargeStatusInput {
  return {
    amountMinor: 10_000,
    amountPaidMinor: 0,
    dueDate: "2026-09-01",
    status: "pending",
    ...overrides,
  };
}

describe("getChargeStatus", () => {
  it.each([
    ["2026-09-01", "pending"],
    [today, "due_today"],
    ["2026-08-30", "overdue"],
  ] as const)("derives %s as %s when nothing has been paid", (dueDate, expected) => {
    expect(getChargeStatus(charge({ dueDate }), today)).toBe(expected);
  });

  it("derives a status when a caller has no persisted status", () => {
    expect(
      getChargeStatus(
        {
          amountMinor: 10_000,
          amountPaidMinor: 0,
          dueDate: "2026-09-01",
        },
        today,
      ),
    ).toBe("pending");
  });

  it.each(["2026-08-30", today, "2026-09-01"])(
    "keeps a partially paid charge partial for due date %s",
    (dueDate) => {
      expect(
        getChargeStatus(
          charge({ amountPaidMinor: 1, dueDate, status: "partial" }),
          today,
        ),
      ).toBe("partial");
    },
  );

  it("derives paid when the exact amount has been received", () => {
    expect(
      getChargeStatus(
        charge({ amountPaidMinor: 10_000, status: "paid" }),
        today,
      ),
    ).toBe("paid");
  });

  it("derives paid when the charge has been overpaid", () => {
    expect(
      getChargeStatus(
        charge({ amountPaidMinor: 10_001, status: "paid" }),
        today,
      ),
    ).toBe("paid");
  });

  it("gives a persisted cancellation precedence over payment and due date", () => {
    expect(
      getChargeStatus(
        charge({
          amountPaidMinor: 20_000,
          dueDate: "2026-08-01",
          status: "cancelled",
        }),
        today,
      ),
    ).toBe("cancelled");
  });

  it("treats a zero-value charge as fully paid", () => {
    expect(
      getChargeStatus(charge({ amountMinor: 0, amountPaidMinor: 0 }), today),
    ).toBe("paid");
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid charge amounts: %s",
    (amountMinor) => {
      expect(() =>
        getChargeStatus(charge({ amountMinor }), today),
      ).toThrow(RangeError);
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid paid amounts: %s",
    (amountPaidMinor) => {
      expect(() =>
        getChargeStatus(charge({ amountPaidMinor }), today),
      ).toThrow(RangeError);
    },
  );

  it("rejects invalid due dates and comparison dates", () => {
    expect(() =>
      getChargeStatus(charge({ dueDate: "2026-02-30" }), today),
    ).toThrow(RangeError);
    expect(() =>
      getChargeStatus(charge(), "2026-8-31"),
    ).toThrow(RangeError);
  });

  it("rejects an invalid persisted status at runtime", () => {
    expect(() =>
      getChargeStatus(charge({ status: "overdue" as never }), today),
    ).toThrow(RangeError);
  });

  it("does not mutate the charge input", () => {
    const input = Object.freeze(charge({ amountPaidMinor: 2_500 }));
    const snapshot = { ...input };

    getChargeStatus(input, today);

    expect(input).toEqual(snapshot);
  });
});

describe("getChargeBalance", () => {
  it("returns the remaining positive balance", () => {
    expect(getChargeBalance(10_000, 2_500)).toBe(7_500);
  });

  it("clamps exact and excess payment balances to zero", () => {
    expect(getChargeBalance(10_000, 10_000)).toBe(0);
    expect(getChargeBalance(10_000, 12_000)).toBe(0);
  });

  it("supports zero and the safe-integer boundary", () => {
    expect(getChargeBalance(0, 0)).toBe(0);
    expect(getChargeBalance(Number.MAX_SAFE_INTEGER, 0)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it.each([
    [-1, 0],
    [0, -1],
    [1.5, 0],
    [0, Number.NaN],
    [Number.MAX_SAFE_INTEGER + 1, 0],
    [0, Number.MAX_SAFE_INTEGER + 1],
  ])("rejects invalid amount pairs (%s, %s)", (amountMinor, amountPaidMinor) => {
    expect(() => getChargeBalance(amountMinor, amountPaidMinor)).toThrow(
      RangeError,
    );
  });
});

describe("getChargeOverpayment", () => {
  it("exposes confirmed excess payment", () => {
    expect(getChargeOverpayment(10_000, 12_500)).toBe(2_500);
  });

  it("returns zero before or at exact payment", () => {
    expect(getChargeOverpayment(10_000, 2_500)).toBe(0);
    expect(getChargeOverpayment(10_000, 10_000)).toBe(0);
  });

  it("supports zero and the safe-integer boundary", () => {
    expect(getChargeOverpayment(0, 0)).toBe(0);
    expect(getChargeOverpayment(0, Number.MAX_SAFE_INTEGER)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("rejects invalid inputs", () => {
    expect(() => getChargeOverpayment(-1, 0)).toThrow(RangeError);
    expect(() => getChargeOverpayment(0, Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });
});
