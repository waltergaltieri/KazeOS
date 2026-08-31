import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/tasks", () => ({
  completeTaskAction: vi.fn().mockResolvedValue({ status: "success" }),
  reopenTaskAction: vi.fn().mockResolvedValue({ status: "success" }),
  deleteTaskAction: vi.fn().mockResolvedValue({ status: "success" }),
}));

import { TaskFilters } from "./task-filters";
import { TaskForm } from "./task-form";
import { TaskList } from "./task-list";

const clientId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const taskId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const clients = [{ id: clientId, label: "Estudio Norte" }];

describe("task UI", () => {
  it("keeps search, client and priority scope across every status view", () => {
    const { container } = render(
      <TaskFilters
        basePath="/tasks"
        clients={clients}
        params={{ search: "informe", status: "overdue", clientId, priority: "high" }}
      />,
    );
    const upcoming = new URL(screen.getByRole("link", { name: "Próximas" }).getAttribute("href")!, "http://localhost");
    expect(Object.fromEntries(upcoming.searchParams)).toEqual({ q: "informe", status: "upcoming", clientId, priority: "high" });
    const search = screen.getByRole("search");
    expect(search.querySelector('input[name="clientId"]')).toHaveValue(clientId);
    expect(search.querySelector('input[name="priority"]')).toHaveValue("high");
    expect(container.querySelector('.task-filter-fields input[name="q"]')).toHaveValue("informe");
    expect(screen.getByRole("link", { name: "Limpiar filtros" })).toHaveAttribute("href", "/tasks");
  });

  it("preselects a client and only enables monthly recurrence with a due date", async () => {
    const user = userEvent.setup();
    render(<TaskForm action={vi.fn().mockResolvedValue({ status: "idle" })} clients={clients} defaultClientId={clientId} />);
    expect(screen.getByRole("combobox", { name: "Cliente" })).toHaveTextContent("Estudio Norte");
    expect(screen.getByLabelText("Repetir mensualmente")).not.toBeChecked();
    expect(screen.queryByText(/se creará la siguiente instancia/i)).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Repetir mensualmente"));
    expect(screen.getByText(/se creará la siguiente instancia/i)).toBeInTheDocument();
    expect(document.querySelector('input[name="recurrence"]')).toHaveValue("monthly");
  });

  it("renders an urgency ledger with an accessible direct completion control", () => {
    render(<TaskList basePath="/tasks" today="2026-08-31" tasks={[{
      id: taskId, clientId, clientName: "Estudio Norte", title: "Enviar informe", description: "Cierre", dueDate: "2026-08-30", priority: "high", status: "pending", recurring: true, recurrence: "monthly", parentId: null, completedAt: null,
    }]} />);
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("Vencida")).toBeInTheDocument();
    expect(within(item).getByText("Prioridad alta")).toBeInTheDocument();
    expect(within(item).getByText("Mensual")).toBeInTheDocument();
    expect(within(item).getByRole("checkbox", { name: "Completar Enviar informe" })).toHaveAttribute("aria-checked", "false");
    expect(within(item).getByRole("link", { name: "Editar Enviar informe" })).toHaveAttribute("href", `/tasks/${taskId}/edit`);
  });

  it("distinguishes a filtered no-result state from a globally empty agenda", () => {
    const { rerender } = render(<TaskList basePath="/tasks" today="2026-08-31" tasks={[]} filtersApplied />);
    expect(screen.getByRole("heading", { name: "No encontramos tareas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Limpiar filtros" })).toHaveAttribute("href", "/tasks");

    rerender(<TaskList basePath="/tasks" today="2026-08-31" tasks={[]} />);
    expect(screen.getByRole("heading", { name: "Tu agenda está al día" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crear tarea" })).toHaveAttribute("href", "/tasks/new");
  });

  it("labels a destructive single-task confirmation with the exact task name", async () => {
    const user = userEvent.setup();
    render(<TaskList basePath="/tasks" today="2026-08-31" tasks={[{
      id: taskId, clientId: null, clientName: null, title: "Ordenar agenda", description: null, dueDate: null, priority: "low", status: "pending", recurring: false, recurrence: null, parentId: null, completedAt: null,
    }]} />);
    await user.click(screen.getByRole("button", { name: "Eliminar Ordenar agenda" }));
    expect(screen.getByRole("group", { name: "Eliminar tarea Ordenar agenda" })).toHaveAccessibleDescription(/sólo esta tarea/i);
    expect(screen.getByRole("button", { name: "Eliminar tarea Ordenar agenda" })).toHaveFocus();
    expect(document.querySelector('input[name="deleteScope"]')).toHaveValue("single");
  });

  it("explains that deleting a recurring root removes the entire series", async () => {
    const user = userEvent.setup();
    render(<TaskList basePath="/tasks" today="2026-08-31" tasks={[{
      id: taskId, clientId, clientName: "Estudio Norte", title: "Cierre mensual", description: null, dueDate: "2026-08-31", priority: "high", status: "completed", recurring: true, recurrence: "monthly", parentId: null, completedAt: new Date("2026-08-31T15:00:00Z"),
    }]} />);
    await user.click(screen.getByRole("button", { name: "Eliminar Cierre mensual" }));
    expect(screen.getByRole("group", { name: "Eliminar serie Cierre mensual" })).toHaveAccessibleDescription(/raíz y todas sus ocurrencias/i);
    expect(screen.getByRole("button", { name: "Eliminar serie Cierre mensual" })).toHaveFocus();
    expect(document.querySelector('input[name="deleteScope"]')).toHaveValue("series");
  });

  it("keeps deletion of a generated occurrence scoped to that occurrence", async () => {
    const user = userEvent.setup();
    render(<TaskList basePath="/tasks" today="2026-08-31" tasks={[{
      id: taskId, clientId, clientName: "Estudio Norte", title: "Cierre de septiembre", description: null, dueDate: "2026-09-30", priority: "high", status: "pending", recurring: false, recurrence: null, parentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", completedAt: null,
    }]} />);
    await user.click(screen.getByRole("button", { name: "Eliminar Cierre de septiembre" }));
    expect(screen.getByRole("group", { name: "Eliminar ocurrencia Cierre de septiembre" })).toHaveAccessibleDescription(/sólo esta ocurrencia/i);
    expect(document.querySelector('input[name="deleteScope"]')).toHaveValue("single");
  });
});
