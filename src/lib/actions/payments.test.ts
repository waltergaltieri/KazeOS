import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), withAuthenticatedDb: vi.fn(), createPayment: vi.fn(), correctPayment: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/db", () => ({ withAuthenticatedDb: mocks.withAuthenticatedDb }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/services/payment-manager", async () => {
  class PaymentOverpayConfirmationRequiredError extends Error { constructor(public overpayMinor = 1) { super(); } }
  class PaymentMismatchError extends Error {}
  class CancelledChargePaymentError extends Error {}
  return { createPayment: mocks.createPayment, correctPayment: mocks.correctPayment, PaymentOverpayConfirmationRequiredError, PaymentMismatchError, CancelledChargePaymentError };
});

import { createPaymentAction } from "./payments";
import { PaymentOverpayConfirmationRequiredError } from "@/lib/services/payment-manager";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const chargeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const clientId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
function data() { const form = new FormData(); Object.entries({ chargeId, clientId, amount: "500,00", currency: "USD", paymentDate: "2026-08-31", paymentMethod: "bank_transfer", reference: "", notes: "" }).forEach(([key, value]) => form.set(key, value)); return form; }

describe("payment actions", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireUser.mockResolvedValue({ id: ownerId }); mocks.withAuthenticatedDb.mockImplementation((_id: string, operation: (db: object) => unknown) => operation({})); mocks.createPayment.mockResolvedValue({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", chargeId }); });
  it("creates a payment only in the verified owner scope", async () => {
    const result = await createPaymentAction({ status: "idle" }, data());
    expect(result).toMatchObject({ status: "success", chargeId });
    expect(mocks.createPayment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ownerId, values: expect.objectContaining({ amountMinor: 50000 }) }));
  });
  it("returns a structured confirmation request for an overpayment", async () => {
    mocks.createPayment.mockRejectedValue(new PaymentOverpayConfirmationRequiredError(100));
    expect(await createPaymentAction({ status: "idle" }, data())).toMatchObject({ status: "confirm_overpay", chargeId });
  });
  it("rejects malformed input before opening a database scope", async () => {
    const form = data(); form.set("amount", "0");
    const result = await createPaymentAction({ status: "idle" }, form);
    expect(result.fieldErrors?.amount).toBeDefined(); expect(mocks.withAuthenticatedDb).not.toHaveBeenCalled();
  });
});
