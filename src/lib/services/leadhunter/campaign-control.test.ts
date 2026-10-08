// @vitest-environment node
import { expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
vi.mock("server-only", () => ({}));
import { controlCampaign } from "./campaign-control";

it("starting a draft campaign never enables email or fabricates a mailbox", async () => {
  const execute = vi.fn().mockResolvedValue([]);
  await controlCampaign({ execute } as never, { ownerId: "owner", campaignId: "campaign", command: "run_now" });
  const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]).sql;
  expect(query).toContain("status='active'");
  expect(query).not.toContain("automation_mode=");
  expect(query).not.toContain("mailbox_id=");
});
