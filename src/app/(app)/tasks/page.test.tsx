import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getTasks: vi.fn(), getTaskFilterOptions: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ withAuthenticatedDb: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/queries/tasks", () => ({ getTasks: mocks.getTasks, getTaskFilterOptions: mocks.getTaskFilterOptions }));
vi.mock("@/lib/domain/commercial-date", () => ({ todayInBusinessZone: () => "2026-08-31" }));

import TasksPage from "./page";

describe("tasks page", () => {
  it("renders the global owner agenda with URL-backed scope", async () => {
    mocks.getTasks.mockResolvedValue([]);
    mocks.getTaskFilterOptions.mockResolvedValue([{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", label: "Estudio Norte" }]);
    render(await TasksPage({ searchParams: Promise.resolve({ q: "informe", status: "overdue", priority: "high" }) }));
    expect(screen.getByRole("heading", { name: "Tareas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nueva tarea" })).toHaveAttribute("href", "/tasks/new");
    expect(mocks.getTasks).toHaveBeenCalledWith(expect.objectContaining({ q: "informe", status: "overdue", priority: "high" }), "2026-08-31");
    expect(screen.getByRole("heading", { name: "No encontramos tareas" })).toBeInTheDocument();
  });
});
