// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const provider = vi.hoisted(() => ({ compose: vi.fn(), review: vi.fn() }));
vi.mock("./minimax-message", () => ({ composeProspectMessageWithMiniMax: provider.compose, reviewMessageGrounding: provider.review }));
import { generateReviewedProspectMessage } from "./message-generation";
import type { MessageBrief } from "./message-brief";
const brief: MessageBrief = {
  campaignId: "c", campaignVersion: 1, enrollmentId: "e", companyName: "Acme", contact: { id: "c", email: "info@example.com" },
  facts: ["Confecciona indumentaria.", "Suministra a comercios.", "Despacha mercadería al interior."].map((value, i) => ({ id: String(i), field: "business_model", value, status: "verified", confidence: 90 })),
  primaryOpportunity: "presencia web", policy: { language: "es-AR", tone: "natural", minimumSpecificFacts: 3,
    wordRange: { minimum: 1, maximum: 300 }, intro: "Soy Walter.", commercialModel: "Suscripción mensual.", cta: "¿Conversamos?", signature: "Walter", requiredSections: [], restrictedPhrases: [] },
};
const claims = ["Fabrican ropa.", "Abastecen a tiendas.", "Envían pedidos fuera de su ciudad."].map((text, i) => ({ text, evidenceIds: [String(i)] }));
const message = { subject: "Acme: una propuesta", body: [brief.policy.intro, ...claims.map(c => c.text), "Les proponemos renovar su presencia digital para facilitar consultas.", brief.policy.commercialModel, brief.policy.cta, brief.policy.signature].join("\n\n"), claims };
describe("semantic review of prospect messages", () => {
  beforeEach(() => { vi.resetAllMocks(); provider.compose.mockResolvedValue(message); });
  it("accepts faithful paraphrases only after semantic review succeeds", async () => {
    provider.review.mockResolvedValue({ valid: true, issues: [] });
    const result = await generateReviewedProspectMessage(brief);
    expect(result.message).toEqual(message);
    expect(provider.review).toHaveBeenCalledWith(brief, [message], { timeoutMs: expect.any(Number) });
  });
  it("keeps unsupported claims blocked and sends the review feedback back to the generator", async () => {
    provider.review.mockResolvedValue({ valid: false, issues: ["Invented lost sales"] });
    await expect(generateReviewedProspectMessage(brief)).rejects.toThrow("Invented lost sales");
    expect(provider.compose).toHaveBeenCalledTimes(3);
    expect(provider.compose.mock.calls[1][1].qualityFeedback).toEqual(["Invented lost sales"]);
    expect(provider.compose.mock.calls[1][1].previousDraft).toEqual(message);
  });
  it("cannot approve unknown evidence IDs even if the reviewer would approve", async () => {
    provider.compose.mockResolvedValue({ ...message, claims: claims.map(c => ({ ...c, evidenceIds: ["unknown"] })) });
    provider.review.mockResolvedValue({ valid: true, issues: [] });
    await expect(generateReviewedProspectMessage(brief)).rejects.toThrow();
    expect(provider.review).not.toHaveBeenCalled();
  });
  it("fails closed when the review is unavailable", async () => {
    provider.review.mockRejectedValue(new Error("Review unavailable"));
    await expect(generateReviewedProspectMessage(brief)).rejects.toThrow("Review unavailable");
  });
});
