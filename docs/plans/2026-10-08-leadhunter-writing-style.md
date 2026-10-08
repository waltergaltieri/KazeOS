# LeadHunter writing style implementation plan

**Goal:** Implement the user-approved first-contact structure without changing researched facts, sender identity, or enabling delivery.

**Design:** Keep greeting and introduction. Turn the business description into a connected, first-person reading of public information, with evidence linked to every factual sentence. Follow with a campaign-aligned primary opportunity and an optional distinct operational hypothesis. Remove the mandatory tools question and intermediate meeting invitations. End with a concise monthly subscription paragraph and one existing invitation.

**Architecture:** Change MiniMax instructions and section assembly, connect campaign tone and word budget, update default policy and operator template. Existing frozen briefs and drafts retain their historical settings; new campaigns use updated defaults. Version newly generated messages so the old generator output is not reused during explicit regeneration. No schema migration or campaign activation.

**Tech stack:** TypeScript, Zod, Vitest, MiniMax Responses, Next.js/Vercel.

1. Add regression tests for optional secondary opportunity, removal of the old transition, preservation of introduction/signature, and propagation of tone/word limits. Run to establish failures.
2. Implement instructions and assembly; update default commercial paragraph, range and required sections. Keep grounding review and factual evidence requirements.
3. Update operator template and generation version. Run focused tests and typecheck.
4. Generate a read-only preview using stored research and the new policy; review actual MiniMax output without sending or altering campaign state.
5. Publish the authorized system update and report scope/results.

## Verification outcome

The focused suite passes 34 tests and TypeScript checks pass. Live read-only previews used saved MS Mayoristas research with the updated policy; no campaign state or outbox was modified. They confirmed the new structure can be assembled, but MiniMax sometimes added unsupported operational assumptions. Some were blocked; its semantic reviewer also accepted examples that failed human review. Added deterministic checks for the observed deduction patterns without weakening grounding checks. This is a style update, not evidence that unattended editorial quality is solved. Campaigns remain paused. A preview-only reasoning/temperature experiment was not adopted; production model settings remain unchanged.
