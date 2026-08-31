import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/client-notes", () => ({
  createClientNoteAction: vi.fn().mockResolvedValue({ status: "idle" }),
  updateClientNoteAction: vi.fn().mockResolvedValue({ status: "idle" }),
  deleteClientNoteAction: vi.fn().mockResolvedValue({ status: "idle" }),
}));

import { NotesTimeline } from "./notes-timeline";

const clientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const notes = [
  { id: "22222222-2222-4222-8222-222222222222", clientId, content: "Nota nueva", createdAt: new Date("2026-08-31T12:00:00Z"), updatedAt: new Date("2026-08-31T12:00:00Z") },
  { id: "11111111-1111-4111-8111-111111111111", clientId, content: "Nota anterior", createdAt: new Date("2026-08-30T12:00:00Z"), updatedAt: new Date("2026-08-30T12:00:00Z") },
];

describe("NotesTimeline", () => {
  it("renders newest first and exposes an accessible create form", () => {
    render(<NotesTimeline clientId={clientId} notes={notes} />);
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([expect.stringContaining("Nota nueva"), expect.stringContaining("Nota anterior")]);
    expect(screen.getByRole("textbox", { name: "Nueva nota" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Agregar nota" })).toBeVisible();
  });

  it("edits inline and names the destructive confirmation with the note", async () => {
    const user = userEvent.setup();
    render(<NotesTimeline clientId={clientId} notes={notes} />);
    await user.click(screen.getByRole("button", { name: "Editar Nota nueva" }));
    expect(screen.getByRole("textbox", { name: "Editar nota Nota nueva" })).toHaveValue("Nota nueva");
    await user.click(screen.getByRole("button", { name: "Eliminar Nota anterior" }));
    expect(screen.getByRole("group", { name: "Eliminar nota Nota anterior" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirmar eliminación de Nota anterior" })).toHaveFocus();
  });
});
