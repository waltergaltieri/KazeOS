import type { MessagePolicy } from "./contracts";

export interface BriefEvidence {
  id: string;
  field: string;
  value: string;
  confidence: number;
  status: "verified" | "inferred" | "conflicting";
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
}

const evidencePriority = new Map([
  ["business_model", 0],
  ["observable_process", 1],
  ["service_opportunity", 2],
  ["digital_presence", 3],
]);

function usableCommercialFact(item: BriefEvidence): boolean {
  const value = item.value.trim();
  if (item.status !== "verified" || item.confidence < 75) return false;
  if (item.field.startsWith("website_")) return false;
  if (/^https?:\/\/\S+$/iu.test(value)) return false;
  if (/^[\[{][\s\S]*[\]}]$/u.test(value)) return false;
  return value.length >= 20;
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
    })
    .slice(0, 8);
  if (!input.contact.email.trim()) throw new Error("A verified recipient is required");
  if (facts.length < input.policy.minimumSpecificFacts) throw new Error("Not enough verified commercial facts");
  return { ...input, companyName: input.companyName.trim(), primaryOpportunity: input.primaryOpportunity.trim(), facts };
}
