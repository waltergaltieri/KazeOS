import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getClientById: vi.fn(), getTasks: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ withAuthenticatedDb: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/queries/clients", () => ({ getClientById: mocks.getClientById }));
vi.mock("@/lib/queries/tasks", () => ({ getTasks: mocks.getTasks }));
vi.mock("@/lib/domain/commercial-date", () => ({ todayInBusinessZone: () => "2026-08-31" }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), useRouter: () => ({ replace: vi.fn() }) }));

import ClientTasksPage from "./page";

describe("client task page", () => {
  it("fixes client scope while preserving agenda filters and create preselection", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    mocks.getClientById.mockResolvedValue({ id, firstName: "Estudio", lastName: "Norte", company: null, status: "active" });
    mocks.getTasks.mockResolvedValue([]);
    render(await ClientTasksPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ status: "today", priority: "high" }) }));
    expect(screen.getByRole("link", { name: "Tareas" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Nueva tarea" })).toHaveAttribute("href", `/tasks/new?clientId=${id}`);
    expect(mocks.getTasks).toHaveBeenCalledWith(expect.objectContaining({ clientId: id, status: "today", priority: "high" }), "2026-08-31");
  });
});
