import "server-only";

import { z } from "zod";

import type { MessageBrief } from "./message-brief";
import type { ComposedMessage } from "./message-composer";

const generatedClaimSchema = z.object({
  text: z.string().trim().min(1).max(1_000),
  evidenceIds: z.array(z.string().uuid()).min(1).max(8),
}).strict();

const generatedMessageSchema = z.object({
  subject: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(12_000),
  claims: z.array(generatedClaimSchema).min(3).max(12),
}).strict();

const generatedFollowUpSchema = generatedMessageSchema.extend({
  subject: z.string().trim().min(1).max(220),
  claims: z.array(generatedClaimSchema).max(6),
});

function jsonObject(text: string): unknown {
  const candidate = text.trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  return JSON.parse(candidate);
}

function normalizedTokens(value: string): Set<string> {
  return new Set(value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase()
    .match(/[a-z0-9]+/gu)?.filter((token) => token.length >= 4) ?? []);
}

function evidenceIdsForText(text: string, facts: MessageBrief["facts"]): string[] {
  const textTokens = normalizedTokens(text);
  return facts.filter(({ value }) => {
    const factTokens = normalizedTokens(value);
    const denominator = Math.min(textTokens.size, factTokens.size);
    if (denominator === 0) return false;
    let overlap = 0;
    for (const token of textTokens) if (factTokens.has(token)) overlap += 1;
    return overlap / denominator >= 0.4;
  }).map(({ id }) => id);
}

function normalizedMessage(raw: unknown, facts: MessageBrief["facts"]): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  const claims = Array.isArray(record.claims)
    ? record.claims.map((item) => {
      if (typeof item === "string") {
        return { text: item, evidenceIds: evidenceIdsForText(item, facts) };
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const claim = item as Record<string, unknown>;
      const candidateText = claim.text ?? claim.claim ?? claim.statement ?? claim.claimText ?? claim.claim_text;
      const fallbackText = Object.values(claim).find((value) => (
        typeof value === "string"
        && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(value)
      ));
      const candidateEvidence = claim.evidenceIds ?? claim.evidence_ids ?? claim.evidenceId ?? claim.evidence_id;
      const text = candidateText ?? fallbackText;
      return {
        text,
        evidenceIds: typeof candidateEvidence === "string"
          ? [candidateEvidence]
          : candidateEvidence ?? (typeof text === "string" ? evidenceIdsForText(text, facts) : undefined),
      };
    }).filter((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const evidenceIds = (item as { evidenceIds?: unknown }).evidenceIds;
      return Array.isArray(evidenceIds) && evidenceIds.length > 0;
    })
    : record.claims;
  return { subject: record.subject, body: record.body, claims };
}

function section(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  throw new Error(`MiniMax omitted message section ${keys[0]}`);
}

function assembleInitialMessage(raw: unknown, brief: MessageBrief): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  if (typeof record.body === "string") return raw;
  return {
    subject: record.subject,
    body: [
      section(record, "opening"),
      brief.policy.intro,
      section(record, "businessUnderstanding", "business_understanding"),
      section(record, "primaryOpportunity", "primary_opportunity"),
      section(record, "operationsTransition", "operations_transition"),
      section(record, "secondaryOpportunity", "secondary_opportunity"),
      brief.policy.commercialModel,
      brief.policy.cta,
      brief.policy.signature,
    ].join("\n\n"),
    claims: record.claims,
  };
}

function assembleFollowUpMessage(
  raw: unknown,
  brief: MessageBrief,
  initialSubject: string,
): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  const suppliedBody = section(record, "body");
  const senderIndex = suppliedBody.indexOf("Walter Quimey Galtieri");
  const bodyWithoutSignature = (senderIndex >= 0 ? suppliedBody.slice(0, senderIndex) : suppliedBody).trim();
  return {
    subject: `Re: ${initialSubject}`,
    body: `${bodyWithoutSignature}\n\n${brief.policy.signature}`,
    claims: record.claims,
  };
}

export async function composeProspectMessageWithMiniMax(
  brief: MessageBrief,
  options: {
    fetch?: typeof fetch;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    qualityFeedback?: string[];
  } = {},
): Promise<ComposedMessage> {
  const apiKey = (options.apiKey ?? process.env.MINIMAX_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("MINIMAX_API_KEY is required to compose outreach");
  const fetcher = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1").replace(/\/+$/u, "");
  const model = (options.model ?? process.env.MINIMAX_MODEL ?? "MiniMax-M3").trim();
  const language = brief.policy.language === "en-US"
    ? "natural professional American English"
    : "español profesional y natural de Argentina";
  const evidence = brief.facts.map(({ id, field, value }) => ({ id, field, value }));
  const instructions = [
    "Write a one-to-one cold outreach email for KazeCode using only the supplied evidence.",
    `Write in ${language}. Return only strict JSON with exactly: subject, opening, businessUnderstanding, primaryOpportunity, operationsTransition, secondaryOpportunity, claims.`,
    `The subject must contain the exact company name: ${brief.companyName}.`,
    "claims must list every company-specific statement used in the body and the supporting evidenceIds.",
    "Use at least three company-specific details. Never invent names, roles, defects, processes or results.",
    "Write only the six requested custom sections. The application will insert the introduction, commercial-model paragraph, CTA and signature separately.",
    "opening must be short and specific. businessUnderstanding must explain the outside-view understanding of the business. primaryOpportunity must propose the main evidence-based improvement. operationsTransition must bridge to reducing manual work. secondaryOpportunity must give one cautious operational or software idea.",
    "Do not pretend to know internal workflows. Invite correction when the public information may be incomplete.",
    "Use plain text only. Never output HTML, Markdown, code, JSON fragments inside the email, emojis or template placeholders.",
    "The six custom sections together must contain between 150 and 260 words; the application adds the fixed sections afterward.",
    "Use only the Latin alphabet for prose. Never insert Chinese, Japanese, Korean or other foreign-script characters.",
    "Every claim text must appear verbatim in one of the six custom sections and cite only supplied evidence IDs.",
    "Avoid generic filler. Every paragraph must add useful information.",
    ...(options.qualityFeedback?.length
      ? [`A previous draft was rejected. Correct all of these issues: ${options.qualityFeedback.join(" ")}`]
      : []),
  ].join(" ");
  const input = JSON.stringify({
    companyName: brief.companyName,
    contact: { firstName: brief.contact.firstName, role: brief.contact.role },
    primaryOpportunity: brief.primaryOpportunity,
    evidence,
    requiredText: {
      introduction: brief.policy.intro,
      commercialModel: brief.policy.commercialModel,
      cta: brief.policy.cta,
      signature: brief.policy.signature,
    },
  });
  const response = await fetcher(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
      max_output_tokens: 3_000,
      reasoning: { effort: "none" },
      temperature: 0.2,
      text: { format: { type: "text" } },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    throw new Error(`MiniMax message request failed with status ${response.status}`);
  }
  const payload = await response.json() as { status?: unknown; output_text?: unknown };
  if (payload.status !== "completed" || typeof payload.output_text !== "string") {
    throw new Error("MiniMax returned an invalid message response");
  }
  const raw = assembleInitialMessage(jsonObject(payload.output_text), brief);
  return generatedMessageSchema.parse(normalizedMessage(raw, brief.facts));
}

export async function composeFollowUpsWithMiniMax(
  brief: MessageBrief,
  initialSubject: string,
  steps: Array<{ bodyInstruction: string; subjectInstruction: string }>,
  options: {
    fetch?: typeof fetch;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    qualityFeedback?: string[];
  } = {},
): Promise<ComposedMessage[]> {
  if (steps.length === 0) return [];
  const apiKey = (options.apiKey ?? process.env.MINIMAX_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("MINIMAX_API_KEY is required to compose outreach");
  const fetcher = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1").replace(/\/+$/u, "");
  const model = (options.model ?? process.env.MINIMAX_MODEL ?? "MiniMax-M3").trim();
  const language = brief.policy.language === "en-US"
    ? "natural professional American English"
    : "español profesional y natural de Argentina";
  const response = await fetcher(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: [
        `Write ${steps.length} distinct follow-up emails in ${language} for the supplied initial outreach.`,
        "Return only strict JSON with exactly one key, followUps. Each item must contain exactly body and claims.",
        "Do not write a subject or signature; the application adds the original thread subject and the verified signature.",
        "Each body content must be 40 to 115 words before the signature, plain text, useful on its own, and follow its corresponding step instruction.",
        "Do not repeat the full initial email. Do not invent facts. Include at least one supported company-specific claim per message.",
        "Never output HTML, Markdown, code, JSON fragments inside the email, emojis, template placeholders, fake urgency or guilt.",
        "Use the supplied CTA naturally when the step calls for a reply or meeting.",
        ...(options.qualityFeedback?.length
          ? [`A previous sequence was rejected. Correct all of these issues: ${options.qualityFeedback.join(" ")}`]
          : []),
      ].join(" "),
      input: JSON.stringify({
        companyName: brief.companyName,
        initialSubject,
        facts: brief.facts.map(({ id, field, value }) => ({ id, field, value })),
        steps,
        cta: brief.policy.cta,
        signature: brief.policy.signature,
      }),
      max_output_tokens: Math.min(6_000, 1_000 + steps.length * 800),
      reasoning: { effort: "none" },
      temperature: 0.2,
      text: { format: { type: "text" } },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`MiniMax follow-up request failed with status ${response.status}`);
  const payload = await response.json() as { status?: unknown; output_text?: unknown };
  if (payload.status !== "completed" || typeof payload.output_text !== "string") {
    throw new Error("MiniMax returned an invalid follow-up response");
  }
  const raw = jsonObject(payload.output_text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("MiniMax returned invalid follow-ups");
  const items = (raw as Record<string, unknown>).followUps ?? (raw as Record<string, unknown>).follow_ups;
  const parsed = z.array(z.unknown()).length(steps.length).parse(items)
    .map((item) => generatedFollowUpSchema.parse(normalizedMessage(
      assembleFollowUpMessage(item, brief, initialSubject),
      brief.facts,
    )));
  return parsed;
}
