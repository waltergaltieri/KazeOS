import { z } from "zod";

const optionalIcon = z.preprocess((value) => {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  return normalized || null;
}, z.string().max(100).nullable());

export const expenseCategoryIdSchema = z.string().uuid(
  "La categoría no es válida.",
);

export const expenseCategoryFormSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio.").max(100),
  icon: optionalIcon,
}).strict();

export type ExpenseCategoryFormValues = z.infer<
  typeof expenseCategoryFormSchema
>;
