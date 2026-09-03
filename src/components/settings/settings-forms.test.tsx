import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  business: vi.fn(),
  getSettings: vi.fn(),
  getCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  toggleCategory: vi.fn(),
}));
vi.mock("@/lib/actions/settings", () => ({
  updateProfileSettingsAction: mocks.profile,
  updateBusinessSettingsAction: mocks.business,
}));
vi.mock("@/lib/actions/expense-categories", () => ({
  createExpenseCategoryAction: mocks.createCategory,
  updateExpenseCategoryAction: mocks.updateCategory,
  toggleExpenseCategoryAction: mocks.toggleCategory,
}));
vi.mock("@/lib/queries/settings", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/lib/queries/expense-categories", () => ({
  getExpenseCategories: mocks.getCategories,
}));

import SettingsPage from "@/app/(app)/settings/page";
import { BusinessForm } from "./business-form";
import { ProfileForm } from "./profile-form";

describe("settings forms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profile.mockResolvedValue({ status: "idle" });
    mocks.business.mockResolvedValue({ status: "idle" });
    mocks.createCategory.mockResolvedValue({ status: "idle" });
    mocks.updateCategory.mockResolvedValue({ status: "idle" });
    mocks.toggleCategory.mockResolvedValue({ status: "idle" });
    mocks.getSettings.mockResolvedValue({
      profile: { fullName: "Agustín", email: "admin@example.com" },
      business: { primaryCurrency: "USD", timezone: "America/Argentina/Buenos_Aires", locale: "es-AR", businessName: null, businessInfo: null },
    });
    mocks.getCategories.mockResolvedValue([{
      id: "11111111-1111-4111-8111-111111111111",
      name: "Servicios",
      icon: "Zap",
      active: true,
    }]);
  });

  it("loads settings and all expense categories together without replacing existing forms", async () => {
    render(await SettingsPage());

    expect(mocks.getSettings).toHaveBeenCalledOnce();
    expect(mocks.getCategories).toHaveBeenCalledWith({ includeInactive: true });
    expect(screen.getByRole("heading", { name: "Perfil" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Negocio y región" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Categorías de gastos" })).toBeVisible();
    expect(screen.getByText("Servicios")).toBeVisible();
  });
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
  it("associates every returned profile field error with its control", async () => {
    mocks.profile.mockResolvedValueOnce({ status: "error", message: "Revisá los campos indicados.", fieldErrors: { fullName: ["Ingresá un nombre válido."] } });
    const user = userEvent.setup();
    render(<ProfileForm profile={{ fullName: "Agustín", email: "admin@example.com" }} />);
    await user.click(screen.getByRole("button", { name: "Guardar perfil" }));
    const input = await screen.findByLabelText("Nombre visible");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "profile-full-name-error");
    expect(screen.getByText("Ingresá un nombre válido.")).toHaveAttribute("id", "profile-full-name-error");
  });
  it("associates every returned business field error with its control", async () => {
    mocks.business.mockResolvedValueOnce({ status: "error", message: "Revisá los campos indicados.", fieldErrors: {
      businessName: ["Nombre inválido."], primaryCurrency: ["Moneda inválida."], timezone: ["Zona inválida."], locale: ["Región inválida."], businessInfo: ["Información inválida."],
    } });
    const user = userEvent.setup();
    render(<BusinessForm settings={{ primaryCurrency: "USD", timezone: "America/Argentina/Buenos_Aires", locale: "es-AR", businessName: null, businessInfo: null }} />);
    await user.click(screen.getByRole("button", { name: "Guardar preferencias" }));
    for (const [name, id] of [["Nombre del negocio", "business-name-error"], ["Moneda principal", "primary-currency-error"], ["Zona horaria", "business-timezone-error"], ["Idioma y región", "business-locale-error"], ["Información del negocio", "business-info-error"]] as const) {
      const control = await screen.findByLabelText(name);
      expect(control).toHaveAttribute("aria-invalid", "true");
      expect(control.getAttribute("aria-describedby")).toContain(id);
      expect(document.getElementById(id)).toBeVisible();
    }
  });
});
