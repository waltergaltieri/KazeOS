import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), withAuthenticatedDb: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/db", () => ({ withAuthenticatedDb: mocks.withAuthenticatedDb }));

import { getClientFinancialHistory } from "./client-financial-history";

describe("getClientFinancialHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    mocks.withAuthenticatedDb.mockImplementation(async (_ownerId, operation) => operation({ execute: vi.fn().mockResolvedValue([
      { id: "p1", kind: "payment", charge_id: "c1", movement_date: "2026-08-31", label: "Pago · Efectivo", amount_minor: "100", currency: "ARS", status: null },
      { id: "c1", kind: "charge", charge_id: "c1", movement_date: "2026-08-30", label: "Servicio", amount_minor: "200", currency: "USD", status: "overdue" },
      { id: "c2", kind: "charge", charge_id: "c2", movement_date: "2026-08-29", label: "Extra", amount_minor: "300", currency: "USD", status: "paid" },
    ]) }));
  });

  it("returns a bounded exact chronological page and scopes through authenticated DB", async () => {
    await expect(getClientFinancialHistory("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "2026-08-31", 2)).resolves.toEqual({
      hasMore: true,
      limit: 2,
      items: [
        { id: "p1", kind: "payment", chargeId: "c1", date: "2026-08-31", label: "Pago · Efectivo", amountMinor: "100", currency: "ARS", status: null },
        { id: "c1", kind: "charge", chargeId: "c1", date: "2026-08-30", label: "Servicio", amountMinor: "200", currency: "USD", status: "overdue" },
      ],
    });
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledWith("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expect.any(Function));
  });
});
