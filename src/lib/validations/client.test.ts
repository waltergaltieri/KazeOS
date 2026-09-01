import { describe, expect, it } from "vitest";

import {
  clientFiltersSchema,
  clientFormSchema,
  clientIdSchema,
  clientUpdateSchema,
} from "./client";

const validClient = {
  firstName: "  Agustín  ",
  lastName: " Pérez ",
  company: " Estudio Norte ",
  email: " AGUSTIN@EXAMPLE.COM ",
  phone: " +54 11 5555-0101 ",
  whatsapp: " ",
  taxId: " 20-12345678-9 ",
  website: " https://example.com ",
  address: " Buenos Aires ",
  notes: " Prefiere contacto por email. ",
  status: "active",
};

describe("clientFormSchema", () => {
  it("normalizes required and optional client fields", () => {
    expect(clientFormSchema.parse(validClient)).toEqual({
      firstName: "Agustín",
      lastName: "Pérez",
      company: "Estudio Norte",
      email: "agustin@example.com",
      phone: "+54 11 5555-0101",
      whatsapp: undefined,
      taxId: "20-12345678-9",
      website: "https://example.com",
      address: "Buenos Aires",
      notes: "Prefiere contacto por email.",
      status: "active",
    });
  });

  it("requires a nonblank first name", () => {
    expect(clientFormSchema.safeParse({ ...validClient, firstName: "   " }).success).toBe(false);
  });

  it("accepts blank optional email and URL but rejects malformed values", () => {
    expect(
      clientFormSchema.safeParse({ ...validClient, email: "", website: "" })
        .success,
    ).toBe(true);
    expect(
      clientFormSchema.safeParse({ ...validClient, email: "not-an-email" })
        .success,
    ).toBe(false);
    expect(
      clientFormSchema.safeParse({ ...validClient, website: "javascript:alert(1)" })
        .success,
    ).toBe(false);
  });

  it("returns a website field error for a malformed URL instead of throwing", () => {
    const result = clientFormSchema.safeParse({
      ...validClient,
      website: "656.ar",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.website).toContain(
        "Ingresá una URL válida.",
      );
    }
  });

  it("constrains status and field sizes", () => {
    expect(
      clientFormSchema.safeParse({ ...validClient, status: "deleted" }).success,
    ).toBe(false);
    expect(
      clientFormSchema.safeParse({ ...validClient, notes: "x".repeat(5001) })
        .success,
    ).toBe(false);
  });
});

describe("clientUpdateSchema", () => {
  it("maps present blank optional fields to null while preserving omitted keys", () => {
    expect(
      clientUpdateSchema.parse({
        firstName: " Agustín ",
        company: " ",
        email: "",
        phone: null,
        whatsapp: " ",
        taxId: "",
        website: null,
        address: " ",
        notes: "",
      }),
    ).toEqual({
      firstName: "Agustín",
      company: null,
      email: null,
      phone: null,
      whatsapp: null,
      taxId: null,
      website: null,
      address: null,
      notes: null,
    });
  });

  it("returns a website field error for a malformed update URL instead of throwing", () => {
    const result = clientUpdateSchema.safeParse({ website: "656.ar" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.website).toContain(
        "Ingresá una URL válida.",
      );
    }
  });
});

describe("client request schemas", () => {
  it("accepts only UUID identifiers", () => {
    expect(
      clientIdSchema.parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    ).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(clientIdSchema.safeParse("not-an-id").success).toBe(false);
  });

  it("normalizes bounded filters and rejects unsupported values", () => {
    expect(
      clientFiltersSchema.parse({ search: " Norte ", filter: "debt" }),
    ).toEqual({ search: "Norte", filter: "debt" });
    expect(clientFiltersSchema.parse({})).toEqual({
      search: undefined,
      filter: "all",
    });
    expect(
      clientFiltersSchema.safeParse({ filter: "deleted" }).success,
    ).toBe(false);
    expect(
      clientFiltersSchema.safeParse({ search: "x".repeat(101) }).success,
    ).toBe(false);
  });
});
