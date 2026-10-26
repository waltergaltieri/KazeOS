import "server-only";
import type { MessageBrief } from "./message-brief";
import { validateProspectMessageStructure, validateFollowUpMessage, type ComposedMessage } from "./message-composer";
import { composeProspectMessageWithMiniMax, composeFollowUpsWithMiniMax, reviewMessageGrounding } from "./minimax-message";

export interface MessageGenerationAttempt {
  attempt: number;
  message?: ComposedMessage;
  validation: { valid: boolean; issues: string[] };
}

/** Paraphrases and translations need semantic review, not matching vocabulary. */
export async function generateReviewedFollowUps(
  brief: MessageBrief,
  initialSubject: string,
  steps: Array<{ bodyInstruction: string; subjectInstruction: string }>,
) {
  if (!steps.length) return [];
  let feedback: string[] = [];
  let prepared: Array<ComposedMessage | undefined> = steps.map(() => undefined);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // Keep each generation small; a five-message reasoning response can exceed
    // the provider timeout and block even an already-approved first contact.
    const results = await Promise.all(steps.map(async (step, index) => {
      if (prepared[index]) return { message: prepared[index], issues: [] };
      try {
        const generated = await composeFollowUpsWithMiniMax(brief, initialSubject, [step], { qualityFeedback: feedback });
        if (generated.length !== 1) return { issues: ["The follow-up sequence is incomplete."] };
        const validation = validateFollowUpMessage(brief, initialSubject, generated[0]!, { requireTokenOverlap: false });
        return { message: validation.valid ? generated[0] : undefined, issues: validation.issues };
      } catch (error) {
        return { issues: [error instanceof Error ? error.message : "Follow-up generation failed"] };
      }
    }));
    prepared = results.map(result => result.message);
    feedback = results.flatMap(result => result.issues);
    if (prepared.some(message => !message)) continue;
    const messages = prepared as ComposedMessage[];
    const review = await reviewMessageGrounding(brief, messages, { timeoutMs: 60_000 });
    if (review.valid) return messages;
    feedback = review.issues;
    prepared = steps.map(() => undefined);
  }
  throw new Error(feedback.join(" ") || "Follow-up sequence failed review");
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
