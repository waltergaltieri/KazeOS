// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const stubs = vi.hoisted(() => ({ build: vi.fn(), generate: vi.fn(), followUps: vi.fn(), analyze: vi.fn() }));
vi.mock("@/lib/leadhunter/message-brief", () => ({ buildMessageBrief: stubs.build }));
vi.mock("@/lib/leadhunter/message-generation", () => ({ generateReviewedProspectMessage: stubs.generate, generateReviewedFollowUps: stubs.followUps }));
vi.mock("@/lib/leadhunter/business-analysis", () => ({ analyzeProspectBusiness: stubs.analyze }));
import { prepareValidatedMessage, type MessageDatabase } from "./message-manager";
import { PgDialect } from "drizzle-orm/pg-core";

beforeEach(() => vi.resetAllMocks());

it("never reactivates a prospect who has already replied", async () => {
  const execute=vi.fn().mockResolvedValue([{ evaluation: "eligible", email: "info@example.com", status: "replied" }]);
  await expect(prepareValidatedMessage({execute} as unknown as MessageDatabase,"owner","enrollment")).rejects.toThrow("not ready");
  expect(execute).toHaveBeenCalledTimes(1);
});

it("reuses a persisted brief when JSONB reorders its website context keys", async () => {
  const website = { evidenceId: "evidence", sourceUrl: "https://example.com", observedAt: "2026-10-10", findings: ["Broken catalog"] };
  const persistedWebsite = { findings: website.findings, observedAt: website.observedAt, sourceUrl: website.sourceUrl, evidenceId: website.evidenceId };
  const brief = { facts: [{ id: "fact" }], websiteContext: website, businessAnalysis: { summary: "Existing analysis" } };
  stubs.build.mockReturnValue(brief);
  const execute = vi.fn()
    .mockResolvedValueOnce([{ evaluation: "eligible", email: "info@example.com", status: "ready", campaignVersion: 1, snapshot: { serviceFocus: "web", strategy: { message: {} } }, automationMode: "drafts" }])
    .mockResolvedValueOnce([]).mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: "existing-brief", brief: { ...brief, websiteContext: persistedWebsite } }])
    .mockResolvedValueOnce([{ id: "existing-message", subject: "Subject", body: "Body" }])
    .mockResolvedValue([]);
  const result = await prepareValidatedMessage({ execute } as unknown as MessageDatabase, "owner", "enrollment");
  expect(result).toEqual({ briefId: "existing-brief", messageVersionId: "existing-message", queued: 0 });
  expect(stubs.analyze).not.toHaveBeenCalled();
  expect(stubs.generate).not.toHaveBeenCalled();
});

it("queues an already validated first contact even if follow-up generation fails", async () => {
  const brief = { facts: [{ id: "fact" }], businessAnalysis: { summary: "Existing analysis" } };
  stubs.build.mockReturnValue(brief);
  const dialect = new PgDialect();
  const statements: string[] = [];
  const execute = vi.fn(async query => {
    const rendered = dialect.sqlToQuery(query).sql;
    statements.push(rendered);
    if (rendered.includes('from "lh_enrollments"')) return [{ evaluation: "eligible", email: "info@example.com", status: "ready", campaignVersion: 1, campaignStatus: "active", automationMode: "automatic", mailboxId: "mailbox", snapshot: { serviceFocus: "web", strategy: { message: {} }, sequenceSteps: [{ delayDays: 0 }, { delayDays: 3 }], schedule: { sendDays: ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"], sendStart:"00:00",sendEnd:"23:59",timezone:"UTC" } } }];
    if (rendered.includes('from "lh_message_briefs"')) return [{ id: "brief", brief }];
    if (rendered.includes('from "lh_message_versions"')) return [{ id: "validated-message", subject: "Subject", body: "Approved body" }];
    if (rendered.includes('insert into "lh_outbox"')) return [{ id: "first-contact" }];
    return [];
  });
  stubs.followUps.mockRejectedValue(new Error("Provider timeout"));
  await expect(prepareValidatedMessage({execute} as unknown as MessageDatabase,"owner","enrollment")).rejects.toThrow("Provider timeout");
  expect(statements.filter(statement => statement.includes('insert into "lh_outbox"'))).toHaveLength(1);
});
