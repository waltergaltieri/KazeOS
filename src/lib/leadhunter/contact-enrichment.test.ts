import { describe, expect, it } from "vitest";

import {
  contactEnrichmentEnvelopeSchema,
  deriveContactSelection,
  normalizePublishedEmail,
  type TrustedContactSource,
} from "./contact-enrichment";

const official: TrustedContactSource = {
  ref: "official-contact",
  sourceUrl: "https://www.example.com/contact",
  sourceType: "official_site",
  contentSha256: "a".repeat(64),
  suppliedAt: "2026-09-30T12:00:00.000Z",
  authority: "official",
};

const directory: TrustedContactSource = {
  ref: "directory-profile",
  sourceUrl: "https://directory.example/profile/acme",
  sourceType: "directory",
  contentSha256: "b".repeat(64),
  suppliedAt: "2026-09-30T12:00:00.000Z",
  authority: "strong_resolved",
};

function observation(overrides: Record<string, unknown> = {}) {
  return {
    sourceRef: official.ref,
    sourceUrl: official.sourceUrl,
    observedAt: official.suppliedAt,
    contentSha256: official.contentSha256,
    extract: "Contact ACME at Sales@Example.com for more information.",
    email: "Sales@Example.com",
    ...overrides,
  };
}

describe("LeadHunter contact enrichment", () => {
  it("selects an exact public address on the verified official domain at high confidence", () => {
    const result = deriveContactSelection({
      officialDomain: "example.com",
      sources: [official],
      observations: [observation()],
      crossLeadEmails: [],
    });

    expect(result).toMatchObject({
      outcome: "selected",
      chosen: {
        displayEmail: "Sales@Example.com",
        normalizedEmail: "sales@example.com",
        confidence: "high",
        confidenceScore: 100,
        sourceRef: official.ref,
      },
      alternates: [],
    });
  });

  it("selects an exact email on a strongly resolved directory at medium confidence", () => {
    const result = deriveContactSelection({
      officialDomain: "acme.com",
      sources: [directory],
      observations: [observation({
        sourceRef: directory.ref,
        sourceUrl: directory.sourceUrl,
        observedAt: directory.suppliedAt,
        contentSha256: directory.contentSha256,
        extract: "Public email: hello@acme.com",
        email: "hello@acme.com",
      })],
      crossLeadEmails: [],
    });

    expect(result.chosen).toMatchObject({
      normalizedEmail: "hello@acme.com",
      confidence: "medium",
      confidenceScore: 75,
    });
  });

  it("rejects a generated info address that is absent from the source", () => {
    const result = deriveContactSelection({
      officialDomain: "example.com",
      sources: [official],
      observations: [observation({
        extract: "Use our contact form to reach the team.",
        email: "info@example.com",
      })],
      crossLeadEmails: [],
    });

    expect(result).toMatchObject({
      outcome: "no_email",
      chosen: null,
    });
    expect(result.reasons).toContain("email_not_exactly_published");
  });

  it("does not infer a person's name from a mailbox local part", () => {
    const result = deriveContactSelection({
      officialDomain: "example.com",
      sources: [official],
      observations: [observation({
        extract: "juan.perez@example.com",
        email: "juan.perez@example.com",
      })],
      crossLeadEmails: [],
    });

    expect(result.chosen).toMatchObject({ firstName: null, lastName: null, role: null });
  });

  it("ranks an explicitly evidenced owner above a generic mailbox", () => {
    const result = deriveContactSelection({
      officialDomain: "example.com",
      sources: [official],
      observations: [
        observation({ email: "info@example.com", extract: "Email info@example.com" }),
        observation({
          email: "maria@example.com",
          extract: "Owner María Pérez: maria@example.com",
          firstName: "María",
          lastName: "Pérez",
          role: "Owner",
        }),
      ],
      crossLeadEmails: [],
    });

    expect(result.chosen?.normalizedEmail).toBe("maria@example.com");
    expect(result.alternates.map(({ normalizedEmail }) => normalizedEmail)).toEqual([
      "info@example.com",
    ]);
  });

  it.each([
    {
      name: "one email assigned to different people",
      observations: [
        observation({ email: "sales@example.com", extract: "Ana Owner sales@example.com", firstName: "Ana", role: "Owner" }),
        observation({ email: "sales@example.com", extract: "Bob Owner sales@example.com", firstName: "Bob", role: "Owner" }),
      ],
      reason: "conflicting_contact_identity",
    },
    {
      name: "one email assigned incompatible roles",
      observations: [
        observation({ email: "sales@example.com", extract: "Ana Owner sales@example.com", firstName: "Ana", role: "Owner" }),
        observation({ email: "sales@example.com", extract: "Ana Accountant sales@example.com", firstName: "Ana", role: "Accountant" }),
      ],
      reason: "conflicting_contact_identity",
    },
    {
      name: "one person assigned irreconcilable addresses",
      observations: [
        observation({ extract: "Ana Owner ana@example.com", email: "ana@example.com", firstName: "Ana", role: "Owner" }),
        observation({ extract: "Ana Owner founder@example.com", email: "founder@example.com", firstName: "Ana", role: "Owner" }),
      ],
      reason: "conflicting_person_addresses",
    },
    {
      name: "equally ranked incompatible decision contacts",
      observations: [
        observation({ extract: "Ana Owner ana@example.com", email: "ana@example.com", firstName: "Ana", role: "Owner" }),
        observation({ extract: "Bob Founder bob@example.com", email: "bob@example.com", firstName: "Bob", role: "Founder" }),
      ],
      reason: "ambiguous_decision_contacts",
    },
  ])("requires review for $name", ({ observations, reason }) => {
    const result = deriveContactSelection({
      officialDomain: "example.com",
      sources: [official],
      observations,
      crossLeadEmails: [],
    });

    expect(result.outcome).toBe("needs_review");
    expect(result.chosen).toBeNull();
    expect(result.reasons).toContain(reason);
  });

  it("normalizes case and Unicode IDN domains deterministically", () => {
    expect(normalizePublishedEmail("VENTAS@MÜNICH.example")).toBe(
      "ventas@xn--mnich-kva.example",
    );
  });

  it("deduplicates one address observed by several sources and preserves evidence refs", () => {
    const result = deriveContactSelection({
      officialDomain: "example.com",
      sources: [directory, official],
      observations: [
        observation({ email: "SALES@example.com", extract: "SALES@example.com" }),
        observation({
          sourceRef: directory.ref,
          sourceUrl: directory.sourceUrl,
          observedAt: directory.suppliedAt,
          contentSha256: directory.contentSha256,
          email: "sales@example.com",
          extract: "sales@example.com",
        }),
      ],
      crossLeadEmails: [],
    });

    expect(result.outcome).toBe("selected");
    expect(result.chosen?.evidenceRefs).toEqual([
      "directory-profile",
      "official-contact",
    ]);
  });

  it("requires review when the normalized email already belongs to another lead", () => {
    const result = deriveContactSelection({
      officialDomain: "example.com",
      sources: [official],
      observations: [observation()],
      crossLeadEmails: ["sales@example.com"],
    });

    expect(result.outcome).toBe("needs_review");
    expect(result.chosen).toBeNull();
    expect(result.reasons).toContain("cross_lead_email_collision");
  });

  it("keeps unknown sources low-confidence and in review", () => {
    const unknown = { ...directory, authority: "unmatched" as const };
    const result = deriveContactSelection({
      officialDomain: "acme.com",
      sources: [unknown],
      observations: [observation({
        sourceRef: unknown.ref,
        sourceUrl: unknown.sourceUrl,
        observedAt: unknown.suppliedAt,
        contentSha256: unknown.contentSha256,
        extract: "hello@acme.com",
        email: "hello@acme.com",
      })],
      crossLeadEmails: [],
    });

    expect(result.outcome).toBe("needs_review");
    expect(result.chosen).toBeNull();
    expect(result.alternates[0]).toMatchObject({ confidence: "low" });
  });

  it("rejects malformed and over-trusting worker envelopes", () => {
    const candidate = observation({
      confidence: 100,
      selected: true,
      inferredRole: "Owner",
    });
    expect(contactEnrichmentEnvelopeSchema.safeParse({
      observations: [candidate],
    }).success).toBe(false);
    expect(contactEnrichmentEnvelopeSchema.safeParse({
      observations: [observation({ sourceUrl: "https://user:pass@example.com" })],
    }).success).toBe(false);
    expect(contactEnrichmentEnvelopeSchema.safeParse({
      observations: [observation({ extract: `sales@example.com\u0000secret` })],
    }).success).toBe(false);
  });

  it("is deterministic regardless of input ordering", () => {
    const observations = [
      observation({ email: "contact@example.com", extract: "contact@example.com" }),
      observation({ email: "sales@example.com", extract: "sales@example.com" }),
    ];
    const base = {
      officialDomain: "example.com",
      sources: [official],
      crossLeadEmails: [] as string[],
    };

    expect(deriveContactSelection({ ...base, observations })).toEqual(
      deriveContactSelection({ ...base, observations: [...observations].reverse() }),
    );
  });
});
