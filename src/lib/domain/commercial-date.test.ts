import { describe, expect, it } from "vitest";

import {
  BUSINESS_TIME_ZONE,
  addCommercialPeriod,
  compareCommercialDates,
  todayInBusinessZone,
  validateCommercialDate,
} from "./commercial-date";

describe("todayInBusinessZone", () => {
  it("uses the previous commercial day before Argentina reaches midnight", () => {
    expect(BUSINESS_TIME_ZONE).toBe("America/Argentina/Buenos_Aires");
    expect(todayInBusinessZone(new Date("2026-08-31T01:30:00.000Z"))).toBe(
      "2026-08-30",
    );
  });

  it("advances when Argentina reaches midnight", () => {
    expect(todayInBusinessZone(new Date("2026-08-31T03:30:00.000Z"))).toBe(
      "2026-08-31",
    );
  });
});

describe("validateCommercialDate", () => {
  it("accepts a canonical leap day", () => {
    expect(validateCommercialDate("2024-02-29")).toBe("2024-02-29");
  });

  it.each(["2023-02-29", "2026-04-31", "2026-13-01", "0000-01-01"])(
    "rejects the impossible calendar date %s",
    (value) => {
      expect(() => validateCommercialDate(value)).toThrow(RangeError);
    },
  );

  it("applies Gregorian century leap-year rules", () => {
    expect(validateCommercialDate("2000-02-29")).toBe("2000-02-29");
    expect(() => validateCommercialDate("1900-02-29")).toThrow(RangeError);
  });

  it.each([
    "2026-8-01",
    "2026-08-1",
    " 2026-08-01",
    "2026-08-01T00:00:00Z",
  ])("rejects the noncanonical date %j", (value) => {
    expect(() => validateCommercialDate(value)).toThrow(RangeError);
  });
});

describe("compareCommercialDates", () => {
  it("orders canonical dates chronologically", () => {
    expect(compareCommercialDates("2026-08-30", "2026-08-31")).toBe(-1);
    expect(compareCommercialDates("2026-08-31", "2026-08-31")).toBe(0);
    expect(compareCommercialDates("2026-09-01", "2026-08-31")).toBe(1);
  });

  it("validates both operands before comparing", () => {
    expect(() =>
      compareCommercialDates("2026-02-30", "2026-03-01"),
    ).toThrow(RangeError);
    expect(() =>
      compareCommercialDates("2026-03-01", "2026-02-30"),
    ).toThrow(RangeError);
  });
});

describe("addCommercialPeriod", () => {
  it("clamps a month end without leaving ISO calendar arithmetic", () => {
    expect(addCommercialPeriod("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(addCommercialPeriod("2024-01-31", "monthly")).toBe("2024-02-29");
  });

  it("clamps leap day when adding a yearly period", () => {
    expect(addCommercialPeriod("2024-02-29", "yearly")).toBe("2025-02-28");
  });

  it("adds a quarterly period across a year boundary", () => {
    expect(addCommercialPeriod("2026-10-31", "quarterly")).toBe(
      "2027-01-31",
    );
    expect(addCommercialPeriod("2026-11-30", "quarterly")).toBe(
      "2027-02-28",
    );
  });

  it("adds multiple periods from the original calendar date", () => {
    expect(addCommercialPeriod("2026-01-31", "monthly", 2)).toBe(
      "2026-03-31",
    );
    expect(addCommercialPeriod("2026-12-31", "yearly", 2)).toBe(
      "2028-12-31",
    );
  });

  it("preserves a canonical date when a yearly period crosses a year", () => {
    expect(addCommercialPeriod("2026-12-31", "yearly")).toBe("2027-12-31");
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects the invalid period count %s",
    (count) => {
      expect(() =>
        addCommercialPeriod("2026-01-01", "monthly", count),
      ).toThrow(RangeError);
    },
  );

  it("rejects invalid dates, frequencies, and out-of-range results", () => {
    expect(() => addCommercialPeriod("2026-02-30", "monthly")).toThrow(
      RangeError,
    );
    expect(() =>
      addCommercialPeriod("2026-01-01", "weekly" as never),
    ).toThrow(RangeError);
    expect(() => addCommercialPeriod("9999-12-31", "monthly")).toThrow(
      RangeError,
    );
  });
});
