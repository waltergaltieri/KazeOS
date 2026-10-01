import { describe, expect, it } from "vitest";

import { buildMessageBrief } from "./message-brief";
import { composeProspectMessage, validateProspectMessage } from "./message-composer";
import { buildMailCommands, nextDeliveryWindow } from "./outbox";
import { nextPipelineStage } from "../services/leadhunter/pipeline-manager";

const evidence = [
  { id: "ev-1", field: "sales_channel", value: "Recibe pedidos mayoristas por WhatsApp", confidence: 92, status: "verified" as const },
  { id: "ev-2", field: "website", value: "El catálogo no permite comprar en línea", confidence: 96, status: "verified" as const },
  { id: "ev-3", field: "location", value: "Opera en Córdoba", confidence: 100, status: "verified" as const },
];

describe("LeadHunter delivery flow", () => {
  it("builds a Spanish evidence-backed message and rejects invented claims", () => {
    const brief = buildMessageBrief({
      campaignId: "campaign", campaignVersion: 2, enrollmentId: "enrollment",
      contact: { id: "contact", email: "ventas@acme.com", firstName: "Ana" },
      companyName: "Acme", evidence, primaryOpportunity: "Automatizar los pedidos mayoristas",
      policy: { language: "es-AR", tone: "directo", minimumSpecificFacts: 2,
        wordRange: { minimum: 35, maximum: 180 }, intro: "Somos KazeCode",
        commercialModel: "Lo implementamos y mantenemos con una mensualidad.",
        cta: "¿Te sirve una charla de 15 minutos?", signature: "Quime\nKazeCode",
        requiredSections: ["opening", "business_understanding", "primary_opportunity", "commercial_model", "cta", "signature"],
        restrictedPhrases: ["garantizamos resultados"] },
    });
    const message = composeProspectMessage(brief);
    expect(message.subject).toContain("Acme");
    expect(message.body).toContain("pedidos mayoristas");
    expect(validateProspectMessage(brief, message)).toEqual({ valid: true, issues: [] });
    expect(validateProspectMessage(brief, { ...message, body: `${message.body}\nAcme duplicará sus ventas.` })).toEqual(expect.objectContaining({ valid: false }));
  });

  it("uses American English policy without phone or WhatsApp CTAs", () => {
    const brief = buildMessageBrief({
      campaignId: "campaign", campaignVersion: 1, enrollmentId: "enrollment",
      contact: { id: "contact", email: "owner@example.com", firstName: "Sam" }, companyName: "Northwind",
      evidence, primaryOpportunity: "Streamline wholesale ordering",
      policy: { language: "en-US", tone: "concise", minimumSpecificFacts: 2,
        wordRange: { minimum: 30, maximum: 180 }, intro: "I’m with KazeCode",
        commercialModel: "We build and maintain it through one monthly subscription.",
        cta: "Would a 15-minute call next week be useful?", signature: "Quime\nKazeCode",
        requiredSections: ["opening", "business_understanding", "primary_opportunity", "commercial_model", "cta", "signature"], restrictedPhrases: [] },
    });
    const result = composeProspectMessage(brief);
    expect(result.body).toContain("Hi Sam");
    expect(result.body).not.toMatch(/contact me on WhatsApp|phone me/i);
  });

  it("schedules a sequence once inside the campaign window", () => {
    const due = nextDeliveryWindow(new Date("2026-09-30T15:00:00Z"), {
      sendDays: ["wednesday", "thursday"], sendStart: "09:00", sendEnd: "17:00", timezone: "America/Argentina/Buenos_Aires",
    });
    const commands = buildMailCommands({ enrollmentId: "enrollment", messageVersionId: "message", recipient: "ventas@acme.com",
      initial: { subject: "Idea para Acme", body: "Hola" }, followUps: [{ delayDays: 3, subjectInstruction: "Seguimiento", bodyInstruction: "¿Pudiste verlo?" }], firstDueAt: due });
    expect(commands).toHaveLength(2);
    expect(commands[0]?.logicalStep).toBe(0);
    expect(commands[1]?.dueAt.getTime()).toBeGreaterThan(commands[0]!.dueAt.getTime());
  });

  it("advances only eligible prospects through the remaining stages", () => {
    expect(nextPipelineStage("qualify", { decision: "eligible" })).toBe("enrich_contact");
    expect(nextPipelineStage("qualify", { decision: "no_email" })).toBe("enrich_contact");
    expect(nextPipelineStage("enrich_contact", { outcome: "selected" })).toBe("prepare_message");
    expect(nextPipelineStage("enrich_contact", { outcome: "no_email" })).toBeNull();
    expect(nextPipelineStage("validate_message", { valid: true })).toBeNull();
  });
});
