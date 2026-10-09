// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  claimNextJob: vi.fn(),
  completeJob: vi.fn(),
  resolveSourceCandidateIdentity: vi.fn(),
  prepareValidatedMessage: vi.fn(),
}));

vi.mock("./job-manager", () => ({
  claimNextJob: mocks.claimNextJob,
  completeJob: mocks.completeJob,
}));

vi.mock("./identity-manager", () => ({
  resolveSourceCandidateIdentity: mocks.resolveSourceCandidateIdentity,
}));
vi.mock("./message-manager", () => ({
  prepareValidatedMessage: mocks.prepareValidatedMessage,
}));

import { htmlToResearchText, publishedBusinessName, researchPageLinks, runAgentIdentityResolution, runAgentMessagePreparation } from "./agent-runner";

describe("LeadHunter agent identity resolution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reduces fetched HTML to visible business text before model research", () => {
    expect(htmlToResearchText(`
      <style>.hidden { display: none }</style>
      <h1>Virales &amp; Mayorista</h1>
      <script>window.secret = "tracking-code";</script>
      <p>Venta mayorista<br>Compra mínima&nbsp;$90.000</p>
    `)).toBe("Virales & Mayorista\nVenta mayorista\nCompra mínima $90.000");
  });

  it("keeps published mailto addresses and removes truncated scripts", () => {
    expect(htmlToResearchText('<a href="mailto:ventas@example.com?subject=Consulta">Escribinos</a><script>window.config={')).toBe("ventas@example.com Escribinos");
  });

  it("uses the site's published business name instead of a generic search slogan", () => {
    expect(publishedBusinessName('<title>Insumos para tu negocio</title><meta content="MS Mayoristas" property="og:site_name">')).toBe("MS Mayoristas");
    expect(publishedBusinessName('<script type="application/ld+json">{"@type":"Organization","name":"Waggon"}</script>')).toBe("Waggon");
    expect(publishedBusinessName('<title>Insumos para tu negocio</title>')).toBeNull();
  });

  it("selects same-site contact and business pages without following external or endless catalog links", () => {
    const html = '<a href="/producto/1">Uno</a><a href="https://other.test/contact">Contact</a><a href="/nosotros">Nosotros</a><a href="/contacto">Contacto</a><a href="/contacto#form">Mail</a>';
    expect(researchPageLinks("https://empresa.example/catalogo", html)).toEqual([
      "https://empresa.example/", "https://empresa.example/nosotros", "https://empresa.example/contacto",
    ]);
  });

  it("uses the identity persisted by the discovery adapter", async () => {
    const identity = {
      name: "Example Mayorista",
      emails: [],
      urls: [{ url: "https://example.com/", role: "official_website" }],
      location: {},
      organizationRole: "unknown",
    };
    mocks.claimNextJob
      .mockResolvedValueOnce({
        id: "00000000-0000-4000-8000-000000000010",
        ownerId: "00000000-0000-4000-8000-000000000001",
        runId: "00000000-0000-4000-8000-000000000002",
        kind: "resolve_identity",
        leaseToken: "lease-token",
        payload: { candidateId: "00000000-0000-4000-8000-000000000003" },
      });
    mocks.resolveSourceCandidateIdentity.mockResolvedValue({
      leadId: null,
      resolutionState: "needs_review",
      outboundProtection: { blocked: false, reason: null },
    });
    mocks.completeJob.mockResolvedValue({ status: "succeeded" });
    const database = {
      transaction: vi.fn(async (operation: (database: unknown) => Promise<unknown>) => operation(database)),
      execute: vi.fn(async () => [{
        canonicalUrl: "https://example.com/",
        sourceType: "web_search",
        rawRecord: {
          observedName: "Example Mayorista",
          observedLocation: null,
          metadata: { identity },
        },
        campaignId: "00000000-0000-4000-8000-000000000004",
        campaignVersion: 1,
        snapshot: { countries: ["AR"], strategy: { research: { questions: [] } } },
      }]),
    };

    await runAgentIdentityResolution(database as never, 1, vi.fn().mockResolvedValue(new Response("<p>Example Mayorista</p>", { headers: { "content-type": "text/html" } })));

    expect(mocks.resolveSourceCandidateIdentity).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ observation: identity }),
    );
  });

  it("researches business capabilities and customers before peripheral site details", () => {
    const links = researchPageLinks("https://empresa.example/", '<a href="/contacto">Contacto</a><a href="/empresa">Empresa</a><a href="/servicios">Servicios</a><a href="/industrias">Industrias</a><a href="/proyectos">Proyectos</a><a href="/faq">FAQ</a><a href="/producto/1">Uno</a>');
    expect(links).toHaveLength(6);
    expect(links.indexOf("https://empresa.example/empresa")).toBeLessThan(links.indexOf("https://empresa.example/contacto"));
    expect(links).toContain("https://empresa.example/industrias");
    expect(links).not.toContain("https://empresa.example/producto/1");
  });

  it("prepares messages outside the job-claim transaction and settles the server-side job", async () => {
    const database = {
      transaction: vi.fn(async (operation: (database: unknown) => Promise<unknown>) => operation(database)),
      execute: vi.fn(),
    };
    mocks.claimNextJob.mockResolvedValueOnce({
      id: "00000000-0000-4000-8000-000000000010",
      ownerId: "00000000-0000-4000-8000-000000000001",
      runId: "00000000-0000-4000-8000-000000000002",
      kind: "prepare_message",
      leaseToken: "lease-token",
      payload: { enrollmentId: "00000000-0000-4000-8000-000000000003" },
    });
    mocks.prepareValidatedMessage.mockResolvedValue({
      messageVersionId: "00000000-0000-4000-8000-000000000004",
    });
    mocks.completeJob.mockResolvedValue({ status: "succeeded" });

    await expect(runAgentMessagePreparation(database as never, 1)).resolves.toEqual({
      processed: 1,
      failed: 0,
    });

    expect(mocks.prepareValidatedMessage).toHaveBeenCalledWith(
      database,
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000003",
    );
    expect(mocks.completeJob).toHaveBeenCalledWith(database, expect.objectContaining({
      completion: { result: {
        kind: "prepare_message",
        output: { messageVersionId: "00000000-0000-4000-8000-000000000004" },
      } },
    }));
  });
});
