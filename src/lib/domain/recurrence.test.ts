import { describe, expect, it } from "vitest";

import {
  buildChargePeriods,
  nextDueDate,
  type RecurringServiceInput,
} from "./recurrence";

const monthlyService: RecurringServiceInput = {
  amountMinor: 125_000,
  billingDay: 31,
  billingFrequency: "monthly",
  billingType: "recurring",
  currency: "USD",
  endDate: null,
  name: "Soporte mensual",
  startDate: "2026-01-31",
  status: "active",
};

describe("nextDueDate", () => {
  it("clamps month ends without losing the original anchor", () => {
    expect(nextDueDate("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextDueDate("2026-01-31", "monthly", 2)).toBe("2026-03-31");
  });

  it("handles leap years and longer frequencies", () => {
    expect(nextDueDate("2024-02-29", "yearly")).toBe("2025-02-28");
    expect(nextDueDate("2026-01-31", "quarterly")).toBe("2026-04-30");
  });
});

describe("buildChargePeriods", () => {
  it("builds the three commercial months starting at the reference date", () => {
    expect(buildChargePeriods(monthlyService, "2026-01-31", 3)).toEqual([
      {
        amountMinor: 125_000,
        currency: "USD",
        description: "Soporte mensual",
        dueDate: "2026-01-31",
        periodKey: "monthly:2026-01",
      },
      {
        amountMinor: 125_000,
        currency: "USD",
        description: "Soporte mensual",
        dueDate: "2026-02-28",
        periodKey: "monthly:2026-02",
      },
      {
        amountMinor: 125_000,
        currency: "USD",
        description: "Soporte mensual",
        dueDate: "2026-03-31",
        periodKey: "monthly:2026-03",
      },
    ]);
  });

  it("uses billing day for the first due date on or after service start", () => {
    expect(
      buildChargePeriods(
        { ...monthlyService, billingDay: 5, startDate: "2026-01-20" },
        "2026-01-01",
        3,
      ).map((candidate) => candidate.dueDate),
    ).toEqual(["2026-02-05", "2026-03-05"]);
  });

  it("keeps only quarterly and yearly occurrences inside the horizon", () => {
    expect(
      buildChargePeriods(
        {
          ...monthlyService,
          billingFrequency: "quarterly",
          startDate: "2026-01-31",
        },
        "2026-01-31",
        7,
      ).map((candidate) => candidate.dueDate),
    ).toEqual(["2026-01-31", "2026-04-30", "2026-07-31"]);

    expect(
      buildChargePeriods(
        {
          ...monthlyService,
          billingFrequency: "yearly",
          startDate: "2024-02-29",
          billingDay: 29,
        },
        "2024-02-01",
        25,
      ).map((candidate) => candidate.dueDate),
    ).toEqual(["2024-02-29", "2025-02-28", "2026-02-28"]);
  });

  it("treats the horizon end as exclusive and the service end as inclusive", () => {
    expect(
      buildChargePeriods(
        { ...monthlyService, endDate: "2026-03-31" },
        "2026-01-31",
        4,
      ).map((candidate) => candidate.dueDate),
    ).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it.each([
    {
      billingDay: null,
      billingType: "one_time" as const,
      billingFrequency: "one_time" as const,
    },
    { status: "paused" as const },
    { status: "cancelled" as const },
  ])("excludes ineligible service %#", (override) => {
    expect(buildChargePeriods({ ...monthlyService, ...override }, "2026-01-01", 3)).toEqual([]);
  });

  it("sorts candidates deterministically and keeps a stable period key", () => {
    const first = buildChargePeriods(monthlyService, "2026-02-01", 3);
    const second = buildChargePeriods(monthlyService, "2026-02-01", 3);
    const changedBillingDay = buildChargePeriods(
      { ...monthlyService, billingDay: 28 },
      "2026-02-01",
      3,
    );

    expect(first).toEqual(second);
    expect(first.map((candidate) => candidate.periodKey)).toEqual(
      changedBillingDay.map((candidate) => candidate.periodKey),
    );
    expect(first.map((candidate) => candidate.dueDate)).toEqual([
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it.each([
    [{ ...monthlyService, amountMinor: 1.5 }, "2026-01-01", 3],
    [{ ...monthlyService, billingDay: 0 }, "2026-01-01", 3],
    [{ ...monthlyService, currency: "EUR" }, "2026-01-01", 3],
    [{ ...monthlyService, endDate: "2025-01-01" }, "2026-01-01", 3],
    [monthlyService, "2026-02-30", 3],
    [monthlyService, "2026-01-01", 0],
  ])("rejects invalid runtime input %#", (service, asOf, horizonMonths) => {
    expect(() =>
      buildChargePeriods(
        service as RecurringServiceInput,
        asOf as string,
        horizonMonths as number,
      ),
    ).toThrow();
  });
});
