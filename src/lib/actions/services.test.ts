import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  withAuthenticatedDb: vi.fn(),
  createServiceWithCharges: vi.fn(),
  updateServiceWithCharges: vi.fn(),
  deactivateServiceWithCharges: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/db", () => ({ withAuthenticatedDb: mocks.withAuthenticatedDb }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/services/service-manager", async () => {
  class ServiceCurrencyLockedError extends Error {}
  return {
    ServiceCurrencyLockedError,
    createServiceWithCharges: mocks.createServiceWithCharges,
    updateServiceWithCharges: mocks.updateServiceWithCharges,
    deactivateServiceWithCharges: mocks.deactivateServiceWithCharges,
  };
});

import {
  createServiceAction,
  deactivateServiceAction,
  updateServiceAction,
} from "./services";
import { ServiceCurrencyLockedError } from "@/lib/services/service-manager";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const serviceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function recurringFormData() {
  const data = new FormData();
  data.set("clientId", clientId);
  data.set("name", " Soporte mensual ");
  data.set("description", " Atención prioritaria ");
  data.set("amount", "1.250,50");
  data.set("currency", "USD");
  data.set("billingType", "recurring");
  data.set("billingFrequency", "monthly");
  data.set("billingDay", "15");
  data.set("startDate", "2026-08-31");
  data.set("endDate", "");
  data.set("status", "active");
  data.set("automaticChargeGeneration", "on");
  return data;
}

describe("service actions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T15:00:00Z"));
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: ownerId });
    mocks.withAuthenticatedDb.mockImplementation(
      (_ownerId: string, operation: (db: object) => unknown) => operation({}),
    );
    mocks.createServiceWithCharges.mockResolvedValue({ id: serviceId });
    mocks.updateServiceWithCharges.mockResolvedValue({ id: serviceId });
    mocks.deactivateServiceWithCharges.mockResolvedValue({ id: serviceId });
  });

  afterEach(() => vi.useRealTimers());

  it("creates with the verified owner and exact parsed amount", async () => {
    const result = await createServiceAction(
      { status: "idle" },
      recurringFormData(),
    );

    expect(result).toEqual({ status: "success", clientId, serviceId });
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledWith(
      ownerId,
      expect.any(Function),
    );
    expect(mocks.createServiceWithCharges).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        asOf: "2026-08-31",
        clientId,
        ownerId,
        values: expect.objectContaining({
          amountMinor: 125_050,
          name: "Soporte mensual",
        }),
      }),
    );
  });

  it("returns structured validation errors before opening the database", async () => {
    const data = recurringFormData();
    data.set("amount", "0");

    const result = await createServiceAction({ status: "idle" }, data);

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.amount).toBeDefined();
    expect(mocks.withAuthenticatedDb).not.toHaveBeenCalled();
  });

  it("maps an immutable currency conflict to a safe form error", async () => {
    mocks.updateServiceWithCharges.mockRejectedValue(
      new ServiceCurrencyLockedError(),
    );
    const data = recurringFormData();
    data.set("serviceId", serviceId);
    data.set("currency", "ARS");

    const result = await updateServiceAction({ status: "idle" }, data);

    expect(result).toEqual({
      status: "error",
      message: "La moneda no puede cambiar porque el servicio ya tiene cargos.",
      fieldErrors: {
        currency: ["Conservá la moneda original para proteger el historial."],
      },
    });
  });

  it("deactivates only a valid owned service without accepting status input", async () => {
    const data = new FormData();
    data.set("clientId", clientId);
    data.set("serviceId", serviceId);
    data.set("status", "cancelled");

    const result = await deactivateServiceAction({ status: "idle" }, data);

    expect(result).toEqual({ status: "success", clientId, serviceId });
    expect(mocks.deactivateServiceWithCharges).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ownerId,
        clientId,
        serviceId,
        status: "paused",
      }),
    );
  });
});
