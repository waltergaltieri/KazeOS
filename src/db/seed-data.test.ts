// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { createDemoSeedData, DEMO_SEED_REFERENCE_DATE } from "./seed-data";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("demo seed contract", () => {
  it("is deterministic, owner-specific and uses stable UUIDs", () => {
    const first = createDemoSeedData(ownerId);
    const second = createDemoSeedData(ownerId);
    const anotherOwner = createDemoSeedData("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

    expect(first).toEqual(second);
    expect(first.referenceDate).toBe("2026-08-31");
    expect(DEMO_SEED_REFERENCE_DATE).toBe("2026-08-31");
    expect(first.clients[0]?.id).not.toBe(anotherOwner.clients[0]?.id);
    const ids = Object.values(first).flatMap((value) => Array.isArray(value) ? value.map((row) => row.id) : []);
    expect(ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains the complete dashboard scenario without wall-clock dates", () => {
    const data = createDemoSeedData(ownerId);
    expect(data.clients.map((client) => client.firstName)).toEqual([
      "Estudio Norte", "Empresa Demo", "Cliente Global", "Tech Solutions", "StartUp Labs",
    ]);
    expect(data.clients.every((client) => client.status === "active")).toBe(true);
    expect(new Set(data.services.map((service) => service.currency))).toEqual(new Set(["USD", "ARS"]));
    expect(data.payments.length).toBeGreaterThanOrEqual(3);
    expect(data.tasks.length).toBeGreaterThanOrEqual(5);
    expect(data.notes.length).toBeGreaterThanOrEqual(3);

    const paymentTotals = new Map<string, number>();
    for (const payment of data.payments) paymentTotals.set(payment.chargeId, (paymentTotals.get(payment.chargeId) ?? 0) + payment.amountMinor);
    const derived = data.charges.map((charge) => {
      const paid = paymentTotals.get(charge.id) ?? 0;
      if (paid >= charge.amountMinor) return "paid";
      if (paid > 0) return "partial";
      return charge.dueDate < data.referenceDate ? "overdue" : "pending";
    });
    expect(new Set(derived)).toEqual(new Set(["paid", "partial", "overdue", "pending"]));
    const source = readFileSync(new URL("./seed-data.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/Date\.now\s*\(|new Date\(\s*\)/);
  });
});
