import { describe, expect, it } from "vitest";

import { clientNoteFormSchema } from "./note";

describe("clientNoteFormSchema", () => {
  it("trims a meaningful client note", () => {
    expect(clientNoteFormSchema.parse({
      clientId: "11111111-1111-4111-8111-111111111111",
      content: "  Llamar después del cierre  ",
    })).toEqual({
      clientId: "11111111-1111-4111-8111-111111111111",
      content: "Llamar después del cierre",
    });
  });

  it.each(["", "   ", "\n\t"])("rejects blank note content", (content) => {
    expect(clientNoteFormSchema.safeParse({
      clientId: "11111111-1111-4111-8111-111111111111",
      content,
    }).success).toBe(false);
  });
});
