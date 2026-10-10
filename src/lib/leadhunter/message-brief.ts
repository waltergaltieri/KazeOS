import type { MessagePolicy } from "./contracts";
import { websiteAuditEnvelopeSchema } from "./website-audit";

export interface BriefEvidence {
  id: string;
  field: string;
  value: string;
  confidence: number;
  status: "verified" | "inferred" | "conflicting";
  sourceUrl?: string;
}

export interface MessageBrief {
  campaignId: string;
  campaignVersion: number;
  enrollmentId: string;
  companyName: string;
  contact: { id: string; email: string; firstName?: string | null; role?: string | null };
  facts: Array<BriefEvidence & { status: "verified" }>;
  primaryOpportunity: string;
  secondaryOpportunity?: string;
  policy: MessagePolicy;
  businessAnalysis?: import("./business-analysis").BusinessAnalysis;
  websiteContext?: { evidenceId: string; sourceUrl: string; observedAt: string; findings: string[] };
}

export function websiteContextForMessage(evidence: BriefEvidence[]): MessageBrief["websiteContext"] {
  const reviews = evidence.filter(row => row.field === "website_visual_review" && row.status === "verified").flatMap(row => {
    try {
      const parsed = websiteAuditEnvelopeSchema.safeParse({ observations: [JSON.parse(row.value)] });
      const review = parsed.success ? parsed.data.observations[0] : undefined;
      return review?.type === "visual_review" ? [{ row, review }] : [];
    } catch { return []; }
  }).sort((a, b) => Date.parse(b.review.observedAt) - Date.parse(a.review.observedAt));
  const latest = reviews[0];
  if (!latest) return undefined;
  const { row, review } = latest;
  const complete = ["desktop", "mobile"].every(viewport => review.screenshots.some(s => s.viewport === viewport));
  return { evidenceId: row.id, sourceUrl: review.source.sourceUrl, observedAt: review.observedAt,
    findings: review.status === "assessed" && review.confidence >= 80 && complete
      ? review.issues.filter(issue => issue.confidence >= 80 && issue.severity !== "minor")
        .map(issue => issue.observation).slice(0, 3) : [] };
}

const evidencePriority = new Map([
  ["business_model", 0],
  ["products_services", 1],
  ["customer_profile", 2],
  ["sales_channels", 3],
  ["observable_process", 4],
  ["business_capabilities", 4],
  ["business_history", 4],
  ["service_coverage", 4],
  ["service_opportunity", 5],
  ["digital_presence", 6],
]);

function usableCommercialFact(item: BriefEvidence): boolean {
  const value = item.value.trim();
  if (item.status !== "verified" || item.confidence < 75) return false;
  if (item.field.startsWith("website_")) return false;
  if (/^https?:\/\/\S+$/iu.test(value)) return false;
  if (/^[\[{][\s\S]*[\]}]$/u.test(value)) return false;
  return value.length >= 20;
}

function displayBusinessName(value: string): string {
  const title = value.trim().replace(/\s+/gu, " ");
  const genericSegment = /^(?:inicio|home|contacto|contact|venta\s+(?:mayorista|minorista)|sitio\s+oficial|official\s+site)$/iu;
  const segments = title.split(/\s*[|·]\s*|\s+[–—-]\s+/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment && !genericSegment.test(segment));
  const selected = segments[0] ?? title;
  const withoutDescriptor = selected.replace(
    /^(.+?)\s+(?:distribuidor(?:a)?|mayorista|minorista|venta\s+(?:mayorista|minorista))\b.*$/iu,
    "$1",
  ).trim();
  return withoutDescriptor || selected;
}

export function buildMessageBrief(input: Omit<MessageBrief, "facts"> & { evidence: BriefEvidence[] }): MessageBrief {
  const seen = new Set<string>();
  const facts = input.evidence
    .filter((item): item is BriefEvidence & { status: "verified" } => usableCommercialFact(item))
    .sort((left, right) => (
      (evidencePriority.get(left.field) ?? 100) - (evidencePriority.get(right.field) ?? 100)
      || right.confidence - left.confidence
    ))
    .filter(({ value }) => {
      const normalized = value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  // Give each business dimension a place before filling the brief with repeated
  // descriptions of the same field from several pages.
  const fieldCounts = new Map<string, number>();
  const diversifiedFacts = facts.map((fact) => {
    const occurrence = fieldCounts.get(fact.field) ?? 0;
    fieldCounts.set(fact.field, occurrence + 1);
    return { fact, occurrence };
  }).sort((a, b) => a.occurrence - b.occurrence).slice(0, 16).map(({ fact }) => fact);
  if (!input.contact.email.trim()) throw new Error("A verified recipient is required");
  if (facts.length < input.policy.minimumSpecificFacts) throw new Error("Not enough verified commercial facts");
  return { ...input, companyName: displayBusinessName(input.companyName), primaryOpportunity: input.primaryOpportunity.trim(), facts: diversifiedFacts,
    websiteContext: websiteContextForMessage(input.evidence) };
}
