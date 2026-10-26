// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const provider = vi.hoisted(() => ({ compose: vi.fn(), followUps: vi.fn(), review: vi.fn() }));
vi.mock("./minimax-message", () => ({ composeProspectMessageWithMiniMax: provider.compose, composeFollowUpsWithMiniMax: provider.followUps, reviewMessageGrounding: provider.review }));
import { generateReviewedProspectMessage, generateReviewedFollowUps } from "./message-generation";
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

describe("semantic review of follow-ups", () => {
  const claim = { text: "Fabrican ropa.", evidenceIds: ["0"] };
  const followUp = { subject: "Re: Acme", body: `Hola. ${claim.text} Quería retomar la propuesta de renovar su presencia digital con una presentación clara de lo que ofrecen. Una web organizada puede ayudar a que quienes buscan un proveedor entiendan su oferta y encuentren cómo contactarlos. El servicio incluye desarrollo, hosting y mantenimiento mediante una suscripción mensual. Si les interesa, podemos seguir por correo.\n\nWalter`, claims: [claim] };
  const steps = [{ bodyInstruction: "Retomar la propuesta", subjectInstruction: "Mismo hilo" }];
  beforeEach(() => { vi.resetAllMocks(); provider.followUps.mockResolvedValue([followUp]); });
  it("accepts paraphrased claims only after semantic approval", async () => {
    provider.review.mockResolvedValue({ valid: true, issues: [] });
    expect(await generateReviewedFollowUps(brief, "Acme", steps)).toEqual([followUp]);
    expect(provider.review).toHaveBeenCalledWith(brief, [followUp], { timeoutMs: 60_000 });
  });
  it("rejects unsupported claims and passes semantic feedback to the retry", async () => {
    provider.review.mockResolvedValue({ valid: false, issues: ["Unsupported current process"] });
    await expect(generateReviewedFollowUps(brief, "Acme", steps)).rejects.toThrow("Unsupported current process");
    expect(provider.followUps.mock.calls[1][3].qualityFeedback).toEqual(["Unsupported current process"]);
  });
  it("blocks nonexistent evidence before semantic review", async () => {
    provider.followUps.mockResolvedValue([{ ...followUp, claims: [{ ...claim, evidenceIds: ["missing"] }] }]);
    await expect(generateReviewedFollowUps(brief, "Acme", steps)).rejects.toThrow();
    expect(provider.review).not.toHaveBeenCalled();
  });
  it("does not approve a sequence when the semantic reviewer is unavailable", async () => {
    provider.review.mockRejectedValue(new Error("Review unavailable"));
    await expect(generateReviewedFollowUps(brief, "Acme", steps)).rejects.toThrow("Review unavailable");
  });
  it("rejects a greeting addressed to the sender instead of the unknown recipient", async () => {
    provider.followUps.mockResolvedValue([{ ...followUp, body: followUp.body.replace("Hola.", "Hola, Walter,") }]);
    provider.review.mockResolvedValue({ valid: true, issues: [] });
    await expect(generateReviewedFollowUps(brief, "Acme", steps)).rejects.toThrow("saludo");
    expect(provider.review).not.toHaveBeenCalled();
  });
  it("retries a transient generation failure without bypassing final review", async () => {
    provider.followUps.mockRejectedValueOnce(new Error("Request timed out")).mockResolvedValue([followUp]);
    provider.review.mockResolvedValue({ valid: true, issues: [] });
    await expect(generateReviewedFollowUps(brief, "Acme", steps)).resolves.toEqual([followUp]);
    expect(provider.followUps).toHaveBeenCalledTimes(2);
    expect(provider.review).toHaveBeenCalledTimes(1);
  });
});
