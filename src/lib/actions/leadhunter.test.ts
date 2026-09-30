import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  withAuthenticatedDb: vi.fn(),
  createCampaign: vi.fn(),
  createLead: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/db", () => ({ withAuthenticatedDb: mocks.withAuthenticatedDb }));
vi.mock("@/lib/services/leadhunter/campaign-manager", () => ({
  createCampaign: mocks.createCampaign,
}));
vi.mock("@/lib/services/leadhunter/lead-manager", () => ({
  createLead: mocks.createLead,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  createLeadHunterCampaignAction,
  createLeadHunterLeadAction,
} from "./leadhunter";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const campaignId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function validCampaignData() {
  const data = new FormData();
  data.set("name", " Mayoristas Argentina ");
  data.set("objective", " Encontrar comercios con pedidos mayoristas manuales. ");
  data.set("serviceFocus", "custom_management");
  data.append("countries", "AR");
  data.append("countries", "US");
  data.append("sources", "web_search");
  data.append("sources", "directories");
  data.set("positiveCriteria", "Catálogo mayorista\nPedidos por WhatsApp");
  data.set("negativeCriteria", "Ya es cliente\nFuera del país");
  data.append("searchDays", "monday");
  data.append("searchDays", "wednesday");
  data.set("searchTime", "09:00");
  data.append("sendDays", "tuesday");
  data.append("sendDays", "thursday");
  data.set("sendStart", "10:00");
  data.set("sendEnd", "16:00");
  data.set("timezone", "America/Argentina/Buenos_Aires");
  data.set("dailyLeadLimit", "30");
  data.set("dailyEmailLimit", "12");
  data.set(
    "sequenceSteps",
    JSON.stringify([
      {
        delayDays: 0,
        subjectInstruction: "Presentar la mejora",
        bodyInstruction: "Hacer una pregunta breve",
      },
    ]),
  );
  data.set("ownerId", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  return data;
}

describe("LeadHunter actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: userId });
    mocks.withAuthenticatedDb.mockImplementation(
      (_ownerId: string, operation: (database: unknown) => unknown) =>
        operation({ marker: "db" }),
    );
    mocks.createCampaign.mockResolvedValue(campaignId);
    mocks.createLead.mockResolvedValue("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  });

  it("creates a manual prospect without requiring an email or website", async () => {
    const data = new FormData();
    data.set("campaignId", campaignId);
    data.set("name", " Distribuidora Sur ");
    data.set("countryCode", "AR");
    data.set("city", "Rosario");
    data.set("description", "Pedidos por teléfono");
    data.set("sourceType", "manual");

    const result = await createLeadHunterLeadAction({ status: "idle" }, data);

    expect(result).toEqual({
      status: "success",
      leadId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      campaignId,
    });
    expect(mocks.createLead).toHaveBeenCalledWith(
      { marker: "db" },
      userId,
      expect.objectContaining({
        name: "Distribuidora Sur",
        website: null,
        email: null,
      }),
    );
  });

  it("creates a draft campaign with the verified owner and normalized lists", async () => {
    const result = await createLeadHunterCampaignAction(
      { status: "idle" },
      validCampaignData(),
    );

    expect(result).toEqual({ status: "success", campaignId });
    expect(mocks.createCampaign).toHaveBeenCalledWith(
      { marker: "db" },
      userId,
      expect.objectContaining({
        name: "Mayoristas Argentina",
        countries: ["AR", "US"],
        sources: ["web_search", "directories"],
        positiveCriteria: ["Catálogo mayorista", "Pedidos por WhatsApp"],
        negativeCriteria: ["Ya es cliente", "Fuera del país"],
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/leadhunter");
  });

  it("returns field errors without opening the database", async () => {
    const data = validCampaignData();
    data.set("name", " ");

    const result = await createLeadHunterCampaignAction(
      { status: "idle" },
      data,
    );

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.name).toBeDefined();
    expect(mocks.withAuthenticatedDb).not.toHaveBeenCalled();
  });

  it("rejects malformed sequence data", async () => {
    const data = validCampaignData();
    data.set("sequenceSteps", "not-json");

    const result = await createLeadHunterCampaignAction(
      { status: "idle" },
      data,
    );

    expect(result).toEqual({
      status: "error",
      message: "Revisá la secuencia de correos.",
    });
    expect(mocks.withAuthenticatedDb).not.toHaveBeenCalled();
  });
});
