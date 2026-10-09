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
