import { describe, expect, it } from "vitest";

import { buildMessageBrief, type MessageBrief } from "./message-brief";
import { validateProspectMessage } from "./message-composer";

const policy: MessageBrief["policy"] = {
  language: "es-AR",
  tone: "Profesional",
  minimumSpecificFacts: 3,
  wordRange: { minimum: 1, maximum: 500 },
  intro: "Soy Walter, cofundador de KazeCode.",
  commercialModel: "Trabajamos mediante una suscripción mensual.",
  cta: "¿Conversamos?",
  signature: "Walter Quimey Galtieri\nCo-Founder, KazeCode",
  requiredSections: ["cta", "signature"],
  restrictedPhrases: [],
};

const base = {
  campaignId: "00000000-0000-4000-8000-000000000001",
  campaignVersion: 1,
  enrollmentId: "00000000-0000-4000-8000-000000000002",
  companyName: "Distribuidora PPP",
  contact: {
    id: "00000000-0000-4000-8000-000000000003",
    email: "info@example.com",
  },
  primaryOpportunity: "ordenar la gestión de pedidos",
  policy,
};

describe("LeadHunter message quality gates", () => {
  it("uses a clean business name instead of the full website title", () => {
    const brief = buildMessageBrief({
      ...base,
      companyName: "Contacto | Comersa Distribuidor Sanitario | Venta Mayorista",
      evidence: [
        { id: "00000000-0000-4000-8000-000000000011", field: "business_model", value: "Distribuye productos sanitarios mediante venta mayorista.", status: "verified", confidence: 90 },
        { id: "00000000-0000-4000-8000-000000000012", field: "observable_process", value: "Publica un formulario para recibir consultas comerciales.", status: "verified", confidence: 90 },
        { id: "00000000-0000-4000-8000-000000000013", field: "digital_presence", value: "Ofrece un boletín de ofertas y novedades para sus clientes.", status: "verified", confidence: 90 },
      ],
    });

    expect(brief.companyName).toBe("Comersa");
  });

  it("excludes technical audit JSON and keeps distinct commercial evidence", () => {
    const brief = buildMessageBrief({
      ...base,
      evidence: [
        { id: "00000000-0000-4000-8000-000000000010", field: "website_reachable", value: '{"result":"response","statusCode":200}', status: "verified", confidence: 95 },
        { id: "00000000-0000-4000-8000-000000000011", field: "business_model", value: "Distribuye alimentos y bebidas a comercios de barrio.", status: "verified", confidence: 90 },
        { id: "00000000-0000-4000-8000-000000000012", field: "observable_process", value: "Publica un catálogo para kioscos, almacenes y supermercados.", status: "verified", confidence: 90 },
        { id: "00000000-0000-4000-8000-000000000013", field: "service_opportunity", value: "Recibe consultas comerciales para compras mayoristas.", status: "verified", confidence: 90 },
      ],
    });

    expect(brief.facts.map(({ field }) => field)).toEqual([
      "business_model",
      "observable_process",
      "service_opportunity",
    ]);
  });

  it("blocks a message containing serialized audit output", () => {
    const brief = buildMessageBrief({
      ...base,
      evidence: [
        { id: "00000000-0000-4000-8000-000000000011", field: "business_model", value: "Distribuye alimentos y bebidas a comercios de barrio.", status: "verified", confidence: 90 },
        { id: "00000000-0000-4000-8000-000000000012", field: "observable_process", value: "Publica un catálogo para kioscos, almacenes y supermercados.", status: "verified", confidence: 90 },
        { id: "00000000-0000-4000-8000-000000000013", field: "service_opportunity", value: "Recibe consultas comerciales para compras mayoristas.", status: "verified", confidence: 90 },
      ],
    });
    const body = [
      brief.policy.intro,
      '{"result":"response","statusCode":200}',
      ...brief.facts.map(({ value }) => value),
      brief.policy.commercialModel,
      brief.policy.cta,
      brief.policy.signature,
    ].join("\n\n");
    const validation = validateProspectMessage(brief, {
      subject: "Una idea para Distribuidora PPP",
      body,
      claims: brief.facts.map(({ id, value }) => ({ text: value, evidenceIds: [id] })),
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContain("El mensaje contiene datos técnicos o serializados.");
  });

  it("blocks internal evidence identifiers from the recipient-facing message", () => {
    const brief = buildMessageBrief({
      ...base,
      evidence: [
        { id: "00000000-0000-4000-8000-000000000011", field: "business_model", value: "Distribuye alimentos y bebidas a comercios de barrio.", status: "verified", confidence: 90 },
        { id: "00000000-0000-4000-8000-000000000012", field: "observable_process", value: "Publica un catálogo para kioscos, almacenes y supermercados.", status: "verified", confidence: 90 },
        { id: "00000000-0000-4000-8000-000000000013", field: "service_opportunity", value: "Recibe consultas comerciales para compras mayoristas.", status: "verified", confidence: 90 },
      ],
    });
    const body = [
      brief.policy.intro,
      "El catálogo de la evidencia 00000000-0000-4000-8000-000000000012 permite revisar la oferta.",
      ...brief.facts.map(({ value }) => value),
      brief.policy.commercialModel,
      brief.policy.cta,
      brief.policy.signature,
    ].join("\n\n");
    const validation = validateProspectMessage(brief, {
      subject: "Una idea para Distribuidora PPP",
      body,
      claims: brief.facts.map(({ id, value }) => ({ text: value, evidenceIds: [id] })),
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContain("El mensaje expone identificadores internos.");
  });

  it("blocks an abbreviated or incorrect sender signature", () => {
    const brief = buildMessageBrief({
      ...base,
      evidence: [
        { id: "00000000-0000-4000-8000-000000000011", field: "business_model", value: "Distribuye alimentos y bebidas a comercios de barrio.", status: "verified", confidence: 90 },
        { id: "00000000-0000-4000-8000-000000000012", field: "observable_process", value: "Publica un catálogo para kioscos, almacenes y supermercados.", status: "verified", confidence: 90 },
        { id: "00000000-0000-4000-8000-000000000013", field: "service_opportunity", value: "Recibe consultas comerciales para compras mayoristas.", status: "verified", confidence: 90 },
      ],
    });
    const body = [
      brief.policy.intro,
      ...brief.facts.map(({ value }) => value),
      brief.policy.commercialModel,
      brief.policy.cta,
      "Quime\nKazeCode",
    ].join("\n\n");
    const validation = validateProspectMessage(brief, {
      subject: "Una idea para Distribuidora PPP",
      body,
      claims: brief.facts.map(({ id, value }) => ({ text: value, evidenceIds: [id] })),
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContain("La firma no coincide con la identidad configurada.");
  });
});
