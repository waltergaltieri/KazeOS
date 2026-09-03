import { describe, expect, it } from "vitest";

import {
  expenseCategoryFormSchema,
  expenseCategoryIdSchema,
} from "./expense-category";

describe("expense category validation", () => {
  it("trims category input and normalizes an empty icon to null", () => {
    expect(expenseCategoryFormSchema.parse({
      name: "  Software  ",
      icon: "  ",
    })).toEqual({ name: "Software", icon: null });
    expect(expenseCategoryFormSchema.parse({
      name: "Servicios",
      icon: "  plug  ",
    })).toEqual({ name: "Servicios", icon: "plug" });
  });

  it("requires a non-empty category name of at most 100 characters", () => {
    expect(expenseCategoryFormSchema.safeParse({ name: "   ", icon: "" }).success)
      .toBe(false);
    expect(expenseCategoryFormSchema.safeParse({
      name: "a".repeat(101),
      icon: "",
    }).success).toBe(false);
  });

  it("validates category identifiers", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(expenseCategoryIdSchema.parse(id)).toBe(id);
    expect(expenseCategoryIdSchema.safeParse("category-1").success).toBe(false);
  });
});
