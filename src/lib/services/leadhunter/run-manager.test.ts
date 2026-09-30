// @vitest-environment node

import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createSearchPlan: vi.fn(() => ({
    planVersion: 1,
    campaignVersion: 4,
    budget: {
      maxQueries: 10,
      plannedQueries: 1,
      maxCandidates: 10,
      totalQueries: 1,
      scannedQueries: 1,
    },
    work: [
      {
        kind: "source_query",
        id: "query:one",
        source: "web_search",
        country: "AR",
        region: null,
        industry: null,
        query: "distribuidores",
        cursor: { state: "initial" },
        geographyEvidence: null,
      },
    ],
    nextPlanningCursor: { offset: 0 },
    planHash: "plan-hash",
  })),
}));

vi.mock("@/lib/leadhunter/search-planner", () => ({
  createSearchPlan: mocks.createSearchPlan,
}));

import {
  planDueRuns,
  type LeadHunterRunDatabase,
} from "./run-manager";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const campaignId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const runId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const scheduledFor = new Date("2026-09-30T12:00:00.000Z");
const dialect = new PgDialect();
const snapshot = {
  dailyLeadLimit: 10,
  schedule: {
    searchDays: ["wednesday", "friday"],
    searchTime: "09:00",
    sendDays: ["tuesday"],
    sendStart: "10:00",
    sendEnd: "16:00",
    timezone: "America/Argentina/Buenos_Aires",
  },
};

function queryText(query: unknown) {
  return dialect.sqlToQuery(query as Parameters<PgDialect["sqlToQuery"]>[0]);
}

describe("planDueRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates jobs only for the first active run in a campaign version slot", async () => {
    let runInsertCount = 0;
    let dueSelectCount = 0;
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered);

      if (rendered.sql.includes("from \"lh_campaigns\"")) {
        dueSelectCount += 1;
        if (dueSelectCount > 1) return [];
        return [{
          ownerId,
          campaignId,
          campaignVersion: 4,
          scheduledFor,
          snapshot,
        }];
      }

      if (rendered.sql.includes("from \"lh_runs\"")) return [];

      if (rendered.sql.includes("insert into \"lh_runs\"")) {
        runInsertCount += 1;
        return runInsertCount === 1 ? [{ id: runId }] : [];
      }

      return [];
    });
    const database = { execute } as unknown as LeadHunterRunDatabase;

    await expect(planDueRuns(database, { now: scheduledFor })).resolves.toEqual({
      dueCampaigns: 1,
      createdRuns: 1,
      createdJobs: 1,
    });
    await expect(planDueRuns(database, { now: scheduledFor })).resolves.toEqual({
      dueCampaigns: 0,
      createdRuns: 0,
      createdJobs: 0,
    });

    const runInsert = statements.find(({ sql }) =>
      sql.includes("insert into \"lh_runs\""));
    expect(runInsert?.sql).toContain("scheduled_for");
    expect(runInsert?.sql).toContain(
      "on conflict (owner_id, campaign_id, campaign_version, scheduled_for)",
    );
    expect(runInsert?.sql).toMatch(
      /where "lh_runs"\."state" in \('planned', 'running'\)\s+do nothing/,
    );
    expect(
      statements.filter(({ sql }) => sql.includes("insert into \"lh_jobs\"")),
    ).toHaveLength(1);
    const campaignUpdate = statements.find(({ sql }) =>
      sql.includes("update \"lh_campaigns\""));
    expect(campaignUpdate?.sql).toContain("last_run_at");
    expect(campaignUpdate?.sql).toContain("next_search_at");
    expect(campaignUpdate?.params).toContainEqual(
      new Date("2026-10-02T12:00:00.000Z"),
    );
    expect(mocks.createSearchPlan).toHaveBeenCalledWith(expect.objectContaining({
      campaignVersion: 4,
      maxQueries: 10,
    }));
  });

  it("continues the durable planning and source cursors from the prior slot", async () => {
    const previousCursors = [{
      source: "web_search",
      country: "AR",
      region: null,
      industry: null,
      query: "distribuidores",
      cursor: { state: "next", value: "page:2" },
    }];
    const database = {
      execute: vi.fn(async (query: unknown) => {
        const rendered = queryText(query).sql;
        if (rendered.includes("from \"lh_campaigns\"")) {
          return [{
            ownerId,
            campaignId,
            campaignVersion: 4,
            scheduledFor,
            snapshot,
          }];
        }
        if (rendered.includes("from \"lh_runs\"")) {
          return [{
            cursor: {
              planningCursor: { offset: 3 },
              previousCursors,
            },
          }];
        }
        if (rendered.includes("insert into \"lh_runs\"")) {
          return [{ id: runId }];
        }
        return [];
      }),
    } as unknown as LeadHunterRunDatabase;

    await planDueRuns(database, { now: scheduledFor });

    expect(mocks.createSearchPlan).toHaveBeenCalledWith(expect.objectContaining({
      planningCursor: { offset: 3 },
      previousCursors,
    }));
  });

  it("locks due campaigns so concurrent cron invocations do not race their slots", async () => {
    const statements: string[] = [];
    const database = {
      execute: vi.fn(async (query: unknown) => {
        const rendered = queryText(query).sql;
        statements.push(rendered);
        return [];
      }),
    } as unknown as LeadHunterRunDatabase;

    await planDueRuns(database, { now: scheduledFor });

    expect(statements[0]).toContain("for update of \"lh_campaigns\" skip locked");
  });
});
