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

export function buildMessageBrief(input: Omit<MessageBrief, "facts"> & { evidence: BriefEvidence[] }): MessageBrief {
  const facts = input.evidence
    .filter((item): item is BriefEvidence & { status: "verified" } => item.status === "verified" && item.confidence >= 75)
    .slice(0, 8);
  if (!input.contact.email.trim()) throw new Error("A verified recipient is required");
  if (facts.length < input.policy.minimumSpecificFacts) throw new Error("Not enough verified facts");
  return { ...input, companyName: input.companyName.trim(), primaryOpportunity: input.primaryOpportunity.trim(), facts };
}
