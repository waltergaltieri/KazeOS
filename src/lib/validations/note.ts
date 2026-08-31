import { z } from "zod";

export const clientNoteIdSchema = z.string().uuid("La nota no es válida.");

export const clientNoteFormSchema = z.object({
  clientId: z.string().uuid("El cliente no es válido."),
  content: z.string().trim().min(1, "La nota no puede estar vacía.").max(4_000, "La nota es demasiado extensa."),
}).strict();

export type ClientNoteFormValues = z.infer<typeof clientNoteFormSchema>;
