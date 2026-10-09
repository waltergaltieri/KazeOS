// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { validateBusinessAnalysis } from "./business-analysis";

const id = "00000000-0000-4000-8000-000000000001";
const observation = { text: "Distribuye repuestos industriales.", evidenceIds: [id] };
const analysis = { business: observation, customers: null, publishedProcess: null,
  opportunity: { desiredOutcome: "Facilitar solicitudes completas de cotización.", proposedChange: "Catálogo con solicitud por pieza.", rationale: "Relacionar la consulta con el producto.", evidenceIds: [id] },
  unknowns: ["No conocemos sus herramientas internas."] };
describe("business analysis", () => {
  it("keeps unknown operations separate from proposed functionality", () => {
    expect(validateBusinessAnalysis(analysis, [id]).publishedProcess).toBeNull();
  });
  it("rejects fabricated evidence identifiers before drafting", () => {
    expect(() => validateBusinessAnalysis(analysis, [])).toThrow(/evidence/i);
  });
});
