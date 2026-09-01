import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

import { ClientForm } from "./client-form";

describe("ClientForm", () => {
  it("distinguishes the client business from its contact person", () => {
    const action = vi.fn(async () => ({ status: "idle" as const }));

    render(<ClientForm action={action} />);

    expect(
      screen.getByRole("heading", { name: "Datos del cliente" }),
    ).toBeVisible();
    expect(
      screen.getByLabelText("Empresa o nombre comercial"),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Persona de contacto" }),
    ).toBeVisible();
    expect(
      screen.getByLabelText("Nombre de la persona de contacto *"),
    ).toBeRequired();
    expect(
      screen.getByLabelText("Apellido de la persona de contacto"),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Datos comerciales" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Notas" })).toBeVisible();
  });
});
