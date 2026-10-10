import "server-only";
import type { MessageBrief } from "./message-brief";
import { validateProspectMessageStructure, type ComposedMessage } from "./message-composer";
import { composeProspectMessageWithMiniMax, reviewMessageGrounding } from "./minimax-message";

export interface MessageGenerationAttempt {
  attempt: number;
  message?: ComposedMessage;
  validation: { valid: boolean; issues: string[] };
}

/** Same bounded generation/review path for production and no-send diagnostics. */
export async function generateReviewedProspectMessage(
  brief: MessageBrief,
  options: { onAttempt?: (attempt: MessageGenerationAttempt) => void } = {},
) {
  let feedback: string[] = [];
  let previousDraft: ComposedMessage | undefined;
  // Reserve time in the 300s worker tick for analysis, persistence and follow-ups.
  const deadline = Date.now() + 140_000;
  const remainingTimeout = () => Math.min(60_000, deadline - Date.now());
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (remainingTimeout() <= 0) break;
    let message: ComposedMessage | undefined;
    let validation: MessageGenerationAttempt["validation"];
    try {
      message = await composeProspectMessageWithMiniMax(brief, { qualityFeedback: feedback, previousDraft, timeoutMs: remainingTimeout() });
      validation = validateProspectMessageStructure(brief, message);
      if (validation.valid) {
        const timeoutMs = remainingTimeout();
        if (timeoutMs <= 0) throw new Error("Message generation time budget exhausted before review");
        validation = await reviewMessageGrounding(brief, [message], { timeoutMs });
      }
    } catch (error) {
      validation = { valid: false, issues: [(error instanceof Error ? error.message : "Message generation failed").slice(0, 1500)] };
    }
    options.onAttempt?.({ attempt, message, validation });
    if (message && validation.valid) return { message, validation };
    feedback = validation.issues;
    if (message) previousDraft = message;
  }
  throw new Error(feedback.join(" ") || "Message generation time budget exhausted");
}
