import { describe, expect, it, vi } from "vitest";
import { advancePipelineAfterResult } from "./pipeline-manager";

describe("research-only runs", () => {
  it.each(["research", "enrich_contact"] as const)("does not schedule any stage after %s", async (kind) => {
    const execute = vi.fn().mockResolvedValueOnce([{ executionMode: "research_only" }]);
    const result = await advancePipelineAfterResult({ execute } as never, {
      ownerId: "owner", runId: "run", enrollmentId: "enrollment", leadId: "lead", kind,
    }, { outcome: "selected" });
    expect(result).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("qualification-only runs", () => {
  it.each(["qualify", "enrich_contact", "prepare_message"] as const)("blocks messaging after %s", async kind => {
    const execute = vi.fn().mockResolvedValueOnce([{ executionMode: "qualification_only" }]);
    await advancePipelineAfterResult({ execute } as never, {
      ownerId: "owner", runId: "run", enrollmentId: "enrollment", leadId: "lead", kind,
    }, { decision: "eligible", outcome: "selected", messageVersionId: "message" });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
