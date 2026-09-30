import { describe, expect, it } from "vitest";

import {
  resolveBusinessIdentity,
  type BusinessIdentity,
} from "./identity";

function business(overrides: Partial<BusinessIdentity> = {}): BusinessIdentity {
  return {
    name: "Acme Distribuciones",
    emails: [],
    urls: [],
    location: {},
    organizationRole: "unknown",
    ...overrides,
  };
}

describe("resolveBusinessIdentity", () => {
  it("matches an official registrable domain when locations are compatible", () => {
    const result = resolveBusinessIdentity(
      business({
        urls: [{ url: "https://ventas.acme.com.ar/catalogo", role: "official_website" }],
        location: { countryCode: "AR", city: "Rosario" },
      }),
      business({
        urls: [{ url: "https://www.acme.com.ar", role: "official_website" }],
        location: { countryCode: "ar", city: "rosario" },
      }),
    );

    expect(result.outcome).toBe("same_business");
    expect(result.reasons).toEqual([
      "normalized_name_match",
      "official_registrable_domain_match",
      "country_match",
      "city_match",
    ]);
  });

  it("matches the same normalized email", () => {
    const result = resolveBusinessIdentity(
      business({ emails: [" VENTAS@Acme.com "] }),
      business({ emails: ["ventas@acme.com"] }),
    );

    expect(result.outcome).toBe("same_business");
    expect(result.signals).toContainEqual(expect.objectContaining({
      code: "normalized_email_match",
      effect: "match",
    }));
  });

  it("does not merge the same name across different countries", () => {
    const result = resolveBusinessIdentity(
      business({ location: { countryCode: "AR", address: "San Martin 100" } }),
      business({ location: { countryCode: "US", address: "100 Main Street" } }),
    );

    expect(result.outcome).toBe("different_business");
    expect(result.reasons).toContain("country_conflict");
  });

  it("requires review for similar names with incompatible addresses", () => {
    const result = resolveBusinessIdentity(
      business({ location: { countryCode: "AR", address: "San Martin 100" } }),
      business({
        name: "Acme Distribuciones SA",
        location: { countryCode: "AR", address: "Cordoba 850" },
      }),
    );

    expect(result.outcome).toBe("needs_review");
    expect(result.reasons).toContain("address_conflict");
  });

  it("requires review when a branch may be confused with its parent", () => {
    const result = resolveBusinessIdentity(
      business({ organizationRole: "branch", parentName: "Acme Distribuciones" }),
      business({ organizationRole: "parent" }),
    );

    expect(result.outcome).toBe("needs_review");
    expect(result.reasons).toContain("branch_parent_ambiguity");
  });

  it("does not use directory or social profile URLs as official domains", () => {
    const result = resolveBusinessIdentity(
      business({
        name: "Negocio Norte",
        urls: [{ url: "https://directory.example/acme", role: "directory" }],
      }),
      business({
        name: "Negocio Sur",
        urls: [{ url: "https://directory.example/other", role: "official_website" }],
      }),
    );

    expect(result.outcome).toBe("different_business");
    expect(result.reasons).not.toContain("official_registrable_domain_match");
  });

  it("rejects known profile hosts even when an upstream source labels them official", () => {
    const result = resolveBusinessIdentity(
      business({
        name: "Negocio Norte",
        urls: [{ url: "https://www.linkedin.com/company/negocio-norte", role: "official_website" }],
      }),
      business({
        name: "Negocio Sur",
        urls: [{ url: "https://linkedin.com/company/negocio-sur", role: "official_website" }],
      }),
    );

    expect(result.outcome).toBe("different_business");
    expect(result.reasons).toContain("normalized_name_conflict");
    expect(result.reasons).not.toContain("official_registrable_domain_match");
  });

  it("returns contributing signals in a stable order", () => {
    const candidate = business({
      emails: ["info@acme.com"],
      urls: [{ url: "https://acme.com", role: "official_website" }],
      location: { countryCode: "AR", city: "Rosario" },
    });
    const existing = business({
      emails: ["INFO@ACME.COM"],
      urls: [{ url: "https://www.acme.com", role: "official_website" }],
      location: { countryCode: "AR", city: "Rosario" },
    });

    expect(resolveBusinessIdentity(candidate, existing)).toEqual(
      resolveBusinessIdentity(candidate, existing),
    );
    expect(resolveBusinessIdentity(candidate, existing).reasons).toEqual([
      "normalized_name_match",
      "normalized_email_match",
      "official_registrable_domain_match",
      "country_match",
      "city_match",
    ]);
  });
});
