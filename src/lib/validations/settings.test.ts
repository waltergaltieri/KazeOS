import { describe, expect, it } from "vitest";

import { businessSettingsSchema, profileSettingsSchema } from "./settings";

describe("settings validation", () => {
  it("accepts the Argentina defaults and normalizes optional business copy", () => {
    expect(businessSettingsSchema.parse({
      primaryCurrency: "ARS",
      timezone: "America/Argentina/Buenos_Aires",
      locale: "es-AR",
      businessName: "  Kaze Studio  ",
      businessInfo: "  Gestión independiente  ",
    })).toEqual({
      primaryCurrency: "ARS",
      timezone: "America/Argentina/Buenos_Aires",
      locale: "es-AR",
      businessName: "Kaze Studio",
      businessInfo: "Gestión independiente",
    });
  });

  it.each([
    { timezone: "Mars/Olympus" },
    { primaryCurrency: "EUR" },
    { locale: "xx-ZZ" },
  ])("rejects unsupported regional settings", (patch) => {
    expect(businessSettingsSchema.safeParse({
      primaryCurrency: "USD",
      timezone: "America/Argentina/Buenos_Aires",
      locale: "es-AR",
      businessName: "Kaze",
      businessInfo: "",
      ...patch,
    }).success).toBe(false);
  });

  it("requires a nonblank profile name", () => {
    expect(profileSettingsSchema.safeParse({ fullName: "   " }).success).toBe(false);
    expect(profileSettingsSchema.parse({ fullName: "  Agustín  " })).toEqual({ fullName: "Agustín" });
  });
});
