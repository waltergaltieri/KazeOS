import { z } from "zod";

import { websiteGateStateSchema } from "./contracts";

const httpUrlSchema = z.string().trim().url().max(2_048).refine(
  (value) => /^https?:\/\//i.test(value),
  "Source URL must use HTTP(S)",
).refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password;
}, "Source URL must not contain credentials");

export const websiteAuditCheckSchema = z.object({
  key: z.enum([
    "official_site",
    "active_commercial_presence",
    "reachable",
    "secure_transport",
    "domain_operational",
    "page_integrity",
    "critical_content",
    "navigation",
    "credibility",
    "critical_information_freshness",
    "presence_consistency",
    "aesthetic",
    "technology_recency",
    "wordpress",
    "typography",
    "copyright_current",
    "ecommerce",
  ]),
  category: z.enum([
    "presence",
    "reliability",
    "security",
    "domain",
    "content",
    "usability",
    "credibility",
    "freshness",
    "presentation",
    "commerce",
  ]),
  outcome: z.enum(["pass", "fail", "unknown"]),
  severity: z.enum(["informational", "minor", "material", "critical"]),
  confidence: z.number().int().min(0).max(100),
  observedAt: z.string().datetime({ offset: true }),
  evidenceIds: z.array(z.string().uuid()).min(1).max(20).transform(
    (values) => [...new Set(values)].sort(),
  ),
  source: z.object({
    sourceType: z.string().trim().min(1).max(80),
    sourceUrl: httpUrlSchema,
  }).strict(),
}).strict();

export const websiteAuditEnvelopeSchema = z.object({
  checks: z.array(websiteAuditCheckSchema).max(100),
}).strict();

export type WebsiteAuditCheck = z.infer<typeof websiteAuditCheckSchema>;

export interface WebsiteAuditResult {
  gateResult: z.infer<typeof websiteGateStateSchema>;
  confidence: number;
  checks: WebsiteAuditCheck[];
  evidenceIds: string[];
  summary: string;
  reasons: string[];
}

export interface WebsiteAuditContext {
  website: string | null | undefined;
  allowedWebsiteOrigins?: string[];
}

const minimumReliableConfidence = 75;
const subjectiveKeys = new Set<WebsiteAuditCheck["key"]>([
  "aesthetic",
  "technology_recency",
  "wordpress",
  "typography",
  "copyright_current",
  "ecommerce",
]);
const goodEnoughKeys: WebsiteAuditCheck["key"][] = [
  "official_site",
  "reachable",
  "critical_content",
  "navigation",
  "critical_information_freshness",
];

function normalizedUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  url.searchParams.sort();
  return url.toString();
}

function normalizedSourceOrigin(value: string): string {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const port = url.port && !(
    (url.protocol === "https:" && url.port === "443")
    || (url.protocol === "http:" && url.port === "80")
  ) ? `:${url.port}` : "";
  return `${hostname}${port}`;
}

function sourceIdentity(check: WebsiteAuditCheck): string {
  return `${check.source.sourceType.toLocaleLowerCase()}:${normalizedSourceOrigin(
    check.source.sourceUrl,
  )}`;
}

function normalizedCheck(check: WebsiteAuditCheck): WebsiteAuditCheck {
  return {
    ...check,
    observedAt: new Date(check.observedAt).toISOString(),
    evidenceIds: [...new Set(check.evidenceIds)].sort(),
    source: {
      sourceType: check.source.sourceType.trim(),
      sourceUrl: normalizedUrl(check.source.sourceUrl),
    },
  };
}

function checkIdentity(check: WebsiteAuditCheck): string {
  return JSON.stringify(check);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function shareEvidence(left: WebsiteAuditCheck, right: WebsiteAuditCheck): boolean {
  const ids = new Set(left.evidenceIds);
  return right.evidenceIds.some((id) => ids.has(id));
}

function independentEvidence(left: WebsiteAuditCheck, right: WebsiteAuditCheck): boolean {
  return !shareEvidence(left, right) && sourceIdentity(left) !== sourceIdentity(right);
}

function reliable(check: WebsiteAuditCheck): boolean {
  return check.confidence >= minimumReliableConfidence && check.outcome !== "unknown";
}

export function evaluateWebsiteAudit(
  rawChecks: WebsiteAuditCheck[],
  context: WebsiteAuditContext = { website: undefined },
): WebsiteAuditResult {
  const parsed = z.array(websiteAuditCheckSchema).max(100).parse(rawChecks);
  const unique = new Map<string, WebsiteAuditCheck>();
  for (const raw of parsed) {
    const check = normalizedCheck(raw);
    unique.set(checkIdentity(check), check);
  }
  const checks = [...unique.values()].sort((left, right) => (
    left.key.localeCompare(right.key)
    || left.observedAt.localeCompare(right.observedAt)
    || checkIdentity(left).localeCompare(checkIdentity(right))
  ));
  const evidenceIds = [...new Set(checks.flatMap((check) => check.evidenceIds))].sort();
  const reasons: string[] = [];

  const conflicts = [...new Set(checks.map(({ key }) => key))]
    .filter((key) => {
      const outcomes = new Set(checks
        .filter((check) => check.key === key && reliable(check))
        .map(({ outcome }) => outcome));
      return outcomes.has("pass") && outcomes.has("fail");
    })
    .sort();
  if (conflicts.length > 0) {
    reasons.push(...conflicts.map((key) => `conflicting_check:${key}`));
    return {
      gateResult: "UNVERIFIED",
      confidence: average(checks.map(({ confidence }) => confidence)),
      checks,
      evidenceIds,
      summary: "Website evidence is conflicting.",
      reasons,
    };
  }

  const allowedWebsiteOrigins = new Set([
    ...(typeof context.website === "string" ? [context.website] : []),
    ...(context.allowedWebsiteOrigins ?? []),
  ].map(normalizedSourceOrigin));
  const targetMismatch = checks.some((check) => {
    const isPresentSiteObservation = check.key !== "active_commercial_presence"
      && !(check.key === "official_site" && check.outcome !== "pass");
    return reliable(check)
      && isPresentSiteObservation
      && (
        typeof context.website !== "string"
        || !allowedWebsiteOrigins.has(normalizedSourceOrigin(check.source.sourceUrl))
      );
  });
  if (targetMismatch) {
    return {
      gateResult: "UNVERIFIED",
      confidence: average(checks.map(({ confidence }) => confidence)),
      checks,
      evidenceIds,
      summary: "Website observations do not match the trusted website target.",
      reasons: ["website_target_mismatch"],
    };
  }

  const officialAbsent = checks.find((check) => (
    check.key === "official_site" && check.outcome === "fail" && reliable(check)
  ));
  const activePresence = checks.find((check) => (
    check.key === "active_commercial_presence"
    && check.outcome === "pass"
    && reliable(check)
    && (!officialAbsent || independentEvidence(check, officialAbsent))
  ));
  if (context.website === null && officialAbsent && activePresence) {
    return {
      gateResult: "NO_WEBSITE",
      confidence: Math.min(officialAbsent.confidence, activePresence.confidence),
      checks,
      evidenceIds,
      summary: "No verified official website; independent evidence confirms active commercial presence.",
      reasons: ["official_site_absent_with_active_presence"],
    };
  }

  const materialFailures = checks.filter((check) => (
    check.outcome === "fail"
    && reliable(check)
    && !subjectiveKeys.has(check.key)
    && check.key !== "official_site"
    && check.key !== "active_commercial_presence"
    && (check.severity === "material" || check.severity === "critical")
  ));
  const corroboratedFailures = materialFailures.filter((check, index) => (
    materialFailures.some((candidate, candidateIndex) => (
      candidateIndex !== index
      && candidate.key !== check.key
      && independentEvidence(check, candidate)
    ))
  ));
  if (typeof context.website === "string" && corroboratedFailures.length >= 2) {
    const selected = [...new Map(corroboratedFailures.map((check) => [check.key, check])).values()]
      .sort((left, right) => left.key.localeCompare(right.key));
    return {
      gateResult: "BAD_WEBSITE",
      confidence: average(selected.map(({ confidence }) => confidence)),
      checks,
      evidenceIds,
      summary: "Multiple independent material website failures were verified.",
      reasons: selected.map(({ key }) => `material_failure:${key}`),
    };
  }

  const goodChecks = goodEnoughKeys.map((key) => checks.find((check) => (
    check.key === key && check.outcome === "pass" && reliable(check)
  )));
  const hasUnresolvedMaterialFailure = checks.some((check) => (
    !subjectiveKeys.has(check.key)
    && (check.severity === "material" || check.severity === "critical")
    && (check.outcome === "fail" || check.outcome === "unknown" || check.confidence < minimumReliableConfidence)
  ));
  if (
    typeof context.website === "string"
    && goodChecks.every((check) => check !== undefined)
    && !hasUnresolvedMaterialFailure
  ) {
    const verified = goodChecks as WebsiteAuditCheck[];
    return {
      gateResult: "GOOD_ENOUGH_WEBSITE",
      confidence: Math.min(...verified.map(({ confidence }) => confidence)),
      checks,
      evidenceIds,
      summary: "The official website is reachable, usable, current and commercially informative.",
      reasons: ["verified_reachable_usable_current_site"],
    };
  }

  return {
    gateResult: "UNVERIFIED",
    confidence: average(checks.map(({ confidence }) => confidence)),
    checks,
    evidenceIds,
    summary: "Available observations do not support a reliable website classification.",
    reasons: ["insufficient_material_website_evidence"],
  };
}
