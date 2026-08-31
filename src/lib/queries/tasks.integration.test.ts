// @vitest-environment node

import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ withAuthenticatedDb: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: vi.fn() }));

import { createAuthenticatedDrizzleRunner } from "@/db/authenticated";
import * as schema from "@/db/schema";
import { clients, tasks } from "@/db/schema";
import { completeTask, createTask, deleteTask, reopenTask, updateTask } from "@/lib/services/task-manager";
import { queryTaskById, queryTasks } from "./tasks";

config({ path: ".env.local", quiet: true });
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const client = databaseUrl ? postgres(databaseUrl, { prepare: false, max: 1 }) : undefined;
const database = client ? drizzle({ client, schema }) : undefined;
const rollback = new Error("ROLLBACK_TASK_QUERY_TEST");

afterAll(async () => client?.end());

describeDatabase("task queries and transactional lifecycle", () => {
  it("filters and mutates only owned tasks with deterministic commercial dates", async () => {
    try {
      await database!.transaction(async (transaction) => {
        const ownerId = randomUUID();
        const otherOwnerId = randomUUID();
        const clientId = randomUUID();
        const otherClientId = randomUUID();
        const overdueId = randomUUID();
        const todayId = randomUUID();
        const upcomingId = randomUUID();
        const undatedId = randomUUID();
        const completedId = randomUUID();

        await transaction.execute(sql`insert into auth.users (id) values (${ownerId}), (${otherOwnerId})`);
        await transaction.insert(clients).values([
          { id: clientId, ownerId, firstName: "Estudio", lastName: "Norte" },
          { id: otherClientId, ownerId: otherOwnerId, firstName: "Cliente", lastName: "Ajeno" },
        ]);
        await transaction.insert(tasks).values([
          { id: overdueId, ownerId, clientId, title: "Renovar dominio", dueDate: "2026-08-14", priority: "low" },
          { id: todayId, ownerId, clientId, title: "Enviar informe", description: "Métricas mensuales", dueDate: "2026-08-15", priority: "high" },
          { id: upcomingId, ownerId, title: "Preparar reunión", dueDate: "2026-08-16", priority: "medium" },
          { id: undatedId, ownerId, title: "Ordenar pendientes", priority: "high" },
          { id: completedId, ownerId, clientId, title: "Tarea terminada", dueDate: "2026-08-01", status: "completed", completedAt: new Date("2026-08-01T15:00:00Z") },
          { ownerId: otherOwnerId, clientId: otherClientId, title: "Tarea ajena", dueDate: "2026-08-15" },
        ]);

        const run = createAuthenticatedDrizzleRunner(transaction);
        await run(ownerId, async (authenticated) => {
          expect((await queryTasks(authenticated, ownerId, { status: "all" }, "2026-08-15")).map((task) => task.id)).toEqual([overdueId, todayId, upcomingId, undatedId, completedId]);
          await expect(queryTasks(authenticated, ownerId, { status: "today" }, "2026-08-15")).resolves.toEqual([expect.objectContaining({ id: todayId, clientName: "Estudio Norte" })]);
          await expect(queryTasks(authenticated, ownerId, { status: "upcoming" }, "2026-08-15")).resolves.toEqual([expect.objectContaining({ id: upcomingId })]);
          await expect(queryTasks(authenticated, ownerId, { status: "overdue" }, "2026-08-15")).resolves.toEqual([expect.objectContaining({ id: overdueId })]);
          await expect(queryTasks(authenticated, ownerId, { status: "completed" }, "2026-08-15")).resolves.toEqual([expect.objectContaining({ id: completedId })]);
          await expect(queryTasks(authenticated, ownerId, { status: "undated" }, "2026-08-15")).resolves.toEqual([expect.objectContaining({ id: undatedId })]);
          expect(await queryTasks(authenticated, ownerId, { status: "all", search: "métricas", clientId, priority: "high" }, "2026-08-15")).toEqual([expect.objectContaining({ id: todayId })]);

          const root = await createTask(authenticated, { ownerId, values: { clientId, title: "Cierre mensual", description: null, dueDate: "2027-01-31", priority: "high", status: "pending", recurring: true, recurrence: "monthly" } });
          const completedAt = new Date("2027-01-31T18:00:00Z");
          const firstCompletion = await completeTask(authenticated, { ownerId, taskId: root.id, completedAt });
          expect(firstCompletion).toMatchObject({ id: root.id, createdNext: true });
          expect((await queryTaskById(authenticated, ownerId, root.id))?.completedAt).toEqual(completedAt);

          const retry = await completeTask(authenticated, { ownerId, taskId: root.id, completedAt: new Date("2027-01-31T19:00:00Z") });
          expect(retry.createdNext).toBe(false);
          const children = await transaction.select().from(tasks).where(sql`${tasks.parentId} = ${root.id}`);
          expect(children).toHaveLength(1);
          expect(children[0]).toMatchObject({ dueDate: "2027-02-28", recurrenceKey: "2027-02-28", status: "pending" });

          await reopenTask(authenticated, { ownerId, taskId: root.id });
          expect((await queryTaskById(authenticated, ownerId, root.id))?.completedAt).toBeNull();
          expect((await completeTask(authenticated, { ownerId, taskId: root.id, completedAt })).createdNext).toBe(false);

          const child = children[0]!;
          expect((await completeTask(authenticated, { ownerId, taskId: child.id, completedAt })).createdNext).toBe(true);
          const chain = await transaction.select().from(tasks).where(sql`${tasks.parentId} = ${root.id}`).orderBy(tasks.dueDate);
          expect(chain).toHaveLength(2);
          expect(chain[1]?.dueDate).toBe("2027-03-31");

          await updateTask(authenticated, { ownerId, taskId: upcomingId, values: { clientId, title: "Preparar reunión editada", description: null, dueDate: null, priority: "high", status: "pending", recurring: false, recurrence: null } });
          expect(await queryTaskById(authenticated, ownerId, upcomingId)).toMatchObject({ title: "Preparar reunión editada", dueDate: null, priority: "high" });
          await deleteTask(authenticated, { ownerId, taskId: upcomingId });
          expect(await queryTaskById(authenticated, ownerId, upcomingId)).toBeNull();
        });

        await run(otherOwnerId, async (authenticated) => {
          expect(await queryTasks(authenticated, otherOwnerId, { status: "all" }, "2026-08-15")).toEqual([expect.objectContaining({ title: "Tarea ajena" })]);
          await expect(completeTask(authenticated, { ownerId: otherOwnerId, taskId: todayId, completedAt: new Date() })).rejects.toThrow();
        });

        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }, 45_000);

  it("serializes concurrent completion and creates one next occurrence", async () => {
    const ownerId = randomUUID();
    const clientId = randomUUID();
    const taskId = randomUUID();
    const firstClient = postgres(databaseUrl!, { prepare: false, max: 1 });
    const secondClient = postgres(databaseUrl!, { prepare: false, max: 1 });
    const firstDatabase = drizzle({ client: firstClient, schema });
    const secondDatabase = drizzle({ client: secondClient, schema });
    let releaseFirst!: () => void;
    let firstCompleted!: () => void;
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const reachedBarrier = new Promise<void>((resolve) => { firstCompleted = resolve; });

    try {
      await database!.execute(sql`insert into auth.users (id) values (${ownerId})`);
      await database!.insert(clients).values({ id: clientId, ownerId, firstName: `Task concurrency ${taskId}` });
      await database!.insert(tasks).values({ id: taskId, ownerId, clientId, title: `Concurrent ${taskId}`, dueDate: "2027-01-31", recurring: true, recurrence: "monthly" });

      const first = createAuthenticatedDrizzleRunner(firstDatabase)(ownerId, async (authenticated) => {
        const result = await completeTask(authenticated, { ownerId, taskId, completedAt: new Date("2027-01-31T18:00:00Z") });
        firstCompleted();
        await release;
        return result;
      });
      await reachedBarrier;
      const second = createAuthenticatedDrizzleRunner(secondDatabase)(ownerId, (authenticated) => completeTask(authenticated, { ownerId, taskId, completedAt: new Date("2027-01-31T19:00:00Z") }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      releaseFirst();

      const results = await Promise.all([first, second]);
      expect(results.filter((result) => result.createdNext)).toHaveLength(1);
      const children = await database!.select().from(tasks).where(sql`${tasks.parentId} = ${taskId}`);
      expect(children).toHaveLength(1);
      expect(children[0]?.recurrenceKey).toBe("2027-02-28");
    } finally {
      releaseFirst?.();
      await firstClient.end();
      await secondClient.end();
      await database!.execute(sql`delete from tasks where parent_id = ${taskId}`);
      await database!.execute(sql`delete from tasks where id = ${taskId}`);
      await database!.execute(sql`delete from clients where id = ${clientId}`);
      await database!.execute(sql`delete from auth.users where id = ${ownerId}`);
    }
  }, 45_000);
});
