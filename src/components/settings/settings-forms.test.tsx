import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/settings", () => ({
  updateProfileSettingsAction: vi.fn().mockResolvedValue({ status: "idle" }),
  updateBusinessSettingsAction: vi.fn().mockResolvedValue({ status: "idle" }),
}));

import { BusinessForm } from "./business-form";
import { ProfileForm } from "./profile-form";

describe("settings forms", () => {
  it("keeps authoritative email read-only and labels profile controls", () => {
    render(<ProfileForm profile={{ fullName: "Agustín", email: "admin@example.com" }} />);
    expect(screen.getByLabelText("Nombre visible")).toHaveValue("Agustín");
    expect(screen.getByLabelText("Email de acceso")).toHaveValue("admin@example.com");
    expect(screen.getByLabelText("Email de acceso")).toBeDisabled();
  });
  it("offers only supported business preferences and explains principal currency", () => {
    render(<BusinessForm settings={{ primaryCurrency: "USD", timezone: "America/Argentina/Buenos_Aires", locale: "es-AR", businessName: null, businessInfo: null }} />);
    expect(screen.getByLabelText("Moneda principal")).toHaveValue("USD");
    expect(screen.getByLabelText("Zona horaria")).toHaveValue("America/Argentina/Buenos_Aires");
    expect(screen.getByLabelText("Idioma y región")).toHaveValue("es-AR");
    expect(screen.getByText(/no convierte ni mezcla los totales/i)).toBeVisible();
  });
});
