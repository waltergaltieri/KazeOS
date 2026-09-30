import { createHash } from "node:crypto";

import { z } from "zod";

import { websiteGateStateSchema } from "./contracts";

const httpUrlSchema = z.string().trim().url().max(2_048).refine(
  (value) => /^https?:\/\//i.test(value),
  "Source URL must use HTTP(S)",
).refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password;
}, "Source URL must not contain credentials");

const sourceSchema = z.object({
  sourceType: z.enum([
    "official_site",
    "directory",
    "instagram",
    "website_scan",
    "http_probe",
    "tls_probe",
    "dns_probe",
  ]),
  sourceUrl: httpUrlSchema,
}).strict();

const observationBase = {
  observedAt: z.string().datetime({ offset: true }),
  source: sourceSchema,
};

export const maximumWebsiteAuditObservations = 100;

const reachabilityResponseObservationSchema = z.object({
  ...observationBase,
  type: z.literal("reachability"),
  result: z.literal("response"),
  statusCode: z.number().int().min(100).max(599),
}).strict();

const reachabilityFailureObservationSchema = z.object({
  ...observationBase,
  type: z.literal("reachability"),
  result: z.literal("failure"),
  error: z.enum(["timeout", "dns", "connection", "tls"]),
}).strict();

const websiteAuditObservationSchema = z.union([
  z.object({
    ...observationBase,
    type: z.literal("official_site"),
    state: z.enum(["present", "absent", "unknown"]),
    targetUrl: httpUrlSchema.nullable(),
  }).strict().superRefine((value, context) => {
    if ((value.state === "present") !== (value.targetUrl !== null)) {
      context.addIssue({
        code: "custom",
        path: ["targetUrl"],
        message: "Only a present official site may have a target URL",
      });
    }
  }),
  z.object({
    ...observationBase,
    type: z.literal("active_commercial_presence"),
    active: z.boolean().nullable(),
  }).strict(),
  reachabilityResponseObservationSchema,
  reachabilityFailureObservationSchema,
  z.object({
    ...observationBase,
    type: z.literal("secure_transport"),
    state: z.enum(["valid", "invalid", "unknown"]),
  }).strict(),
  z.object({
    ...observationBase,
    type: z.literal("domain_operational"),
    state: z.enum(["operational", "failed", "unknown"]),
  }).strict(),
  z.object({
    ...observationBase,
    type: z.literal("page_integrity"),
    checkedPages: z.number().int().min(0).max(500),
    brokenPages: z.number().int().min(0).max(500),
  }).strict().refine((value) => value.brokenPages <= value.checkedPages, {
    path: ["brokenPages"], message: "brokenPages cannot exceed checkedPages",
  }),
  z.object({
    ...observationBase,
    type: z.literal("critical_content"),
    requiredItems: z.array(z.enum([
      "services", "products", "contact", "location", "hours", "pricing",
    ])).min(1).max(20).transform((values) => [...new Set(values)].sort()),
    missingItems: z.array(z.enum([
      "services", "products", "contact", "location", "hours", "pricing",
    ])).max(20).transform((values) => [...new Set(values)].sort()),
  }).strict().superRefine((value, context) => {
    const required = new Set(value.requiredItems);
    if (value.missingItems.some((item) => !required.has(item))) {
      context.addIssue({ code: "custom", path: ["missingItems"], message: "Missing items must be required" });
    }
  }),
  z.object({
    ...observationBase,
    type: z.literal("navigation"),
    testedPaths: z.number().int().min(0).max(500),
    brokenPaths: z.number().int().min(0).max(500),
  }).strict().refine((value) => value.brokenPaths <= value.testedPaths, {
    path: ["brokenPaths"], message: "brokenPaths cannot exceed testedPaths",
  }),
  z.object({
    ...observationBase,
    type: z.literal("critical_information_freshness"),
    checkedCriticalItems: z.number().int().min(0).max(500),
    staleCriticalItems: z.number().int().min(0).max(500),
  }).strict().refine((value) => value.staleCriticalItems <= value.checkedCriticalItems, {
    path: ["staleCriticalItems"], message: "staleCriticalItems cannot exceed checkedCriticalItems",
  }),
  z.object({
    ...observationBase,
    type: z.literal("presence_consistency"),
    checkedProfiles: z.number().int().min(0).max(500),
    conflictingProfiles: z.number().int().min(0).max(500),
  }).strict().refine((value) => value.conflictingProfiles <= value.checkedProfiles, {
    path: ["conflictingProfiles"], message: "conflictingProfiles cannot exceed checkedProfiles",
  }),
  z.object({
    ...observationBase,
    type: z.literal("redirect"),
    fromUrl: httpUrlSchema,
    toUrl: httpUrlSchema,
    permanent: z.boolean(),
  }).strict(),
  z.object({
    ...observationBase,
    type: z.literal("subjective"),
    key: z.enum(["aesthetic", "technology_recency", "typography"]),
    note: z.string().trim().min(1).max(500),
  }).strict(),
]);

export const websiteAuditObservationEnvelopeSchema = z.object({
  observations: z.array(websiteAuditObservationSchema).max(maximumWebsiteAuditObservations),
}).strict();

export const websiteAuditEnvelopeSchema = websiteAuditObservationEnvelopeSchema;

export type WebsiteAuditObservation = z.infer<typeof websiteAuditObservationSchema>;

export interface DerivedWebsiteAuditEvidence {
  id: string;
  field: string;
  value: string;
  confidence: number;
  observedAt: string;
  source: { sourceType: string; sourceUrl: string };
}

export interface DerivedWebsiteAuditObservations {
  checks: WebsiteAuditCheck[];
  evidence: DerivedWebsiteAuditEvidence[];
  allowedWebsiteOrigins: string[];
  contextEvidenceIds: string[];
}

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
  contextEvidenceIds?: string[];
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

function stableUuid(parts: unknown[]): string {
  const digest = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  const bytes = digest.slice(0, 32).split("");
  bytes[12] = "5";
  bytes[16] = ((Number.parseInt(bytes[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = bytes.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function observationEvidence(
  namespace: string,
  observation: WebsiteAuditObservation,
  field: string,
  value: Record<string, unknown>,
  confidence: number,
): DerivedWebsiteAuditEvidence {
  const observedAt = new Date(observation.observedAt).toISOString();
  const source = {
    sourceType: observation.source.sourceType,
    sourceUrl: normalizedUrl(observation.source.sourceUrl),
  };
  const canonicalValue = JSON.stringify(value);
  return {
    id: stableUuid([namespace, field, canonicalValue, source, observedAt]),
    field,
    value: canonicalValue,
    confidence,
    observedAt,
    source,
  };
}

function derivedCheck(
  evidence: DerivedWebsiteAuditEvidence,
  input: Pick<WebsiteAuditCheck, "key" | "category" | "outcome" | "severity">,
): WebsiteAuditCheck {
  return websiteAuditCheckSchema.parse({
    ...input,
    confidence: evidence.confidence,
    observedAt: evidence.observedAt,
    evidenceIds: [evidence.id],
    source: evidence.source,
  });
}

export function deriveWebsiteAuditObservations(
  rawObservations: WebsiteAuditObservation[],
  context: { namespace: string; website: string | null | undefined },
): DerivedWebsiteAuditObservations {
  const observations = z.array(websiteAuditObservationSchema)
    .max(maximumWebsiteAuditObservations)
    .parse(rawObservations);
  const ordered = [...observations].sort((left, right) => (
    JSON.stringify(left).localeCompare(JSON.stringify(right))
  ));
  const allowedWebsiteOrigins = new Set<string>();
  const allowedWebsiteUrls = new Set<string>();
  if (typeof context.website === "string") {
    allowedWebsiteOrigins.add(normalizedSourceOrigin(context.website));
    allowedWebsiteUrls.add(new URL(context.website).origin);
  }
  const evidence = new Map<string, DerivedWebsiteAuditEvidence>();
  const contextEvidenceIds = new Set<string>();
  const checks: WebsiteAuditCheck[] = [];

  for (const observation of ordered.filter(({ type }) => type === "redirect")) {
    if (observation.type !== "redirect") continue;
    if (
      typeof context.website !== "string"
      || normalizedSourceOrigin(observation.fromUrl) !== normalizedSourceOrigin(context.website)
      || normalizedSourceOrigin(observation.source.sourceUrl)
        !== normalizedSourceOrigin(observation.fromUrl)
    ) {
      throw new TypeError("Redirect observation does not match the trusted website target");
    }
    allowedWebsiteOrigins.add(normalizedSourceOrigin(observation.toUrl));
    allowedWebsiteUrls.add(new URL(observation.toUrl).origin);
    const row = observationEvidence(
      context.namespace,
      observation,
      "website_redirect_target",
      {
        fromUrl: normalizedUrl(observation.fromUrl),
        toUrl: normalizedUrl(observation.toUrl),
        permanent: observation.permanent,
      },
      95,
    );
    evidence.set(row.id, row);
    contextEvidenceIds.add(row.id);
  }

  for (const observation of ordered) {
    if (observation.type === "redirect") continue;
    if (observation.type === "official_site") {
      const targetMatches = observation.state === "present"
        && typeof context.website === "string"
        && observation.targetUrl !== null
        && allowedWebsiteOrigins.has(normalizedSourceOrigin(observation.targetUrl));
      const absenceMatches = observation.state === "absent" && context.website === null;
      const outcome = targetMatches ? "pass" : absenceMatches ? "fail" : "unknown";
      const row = observationEvidence(
        context.namespace, observation, "website_official_site",
        { state: observation.state, targetUrl: observation.targetUrl && normalizedUrl(observation.targetUrl) },
        outcome === "unknown" ? 0 : 95,
      );
      evidence.set(row.id, row);
      checks.push(derivedCheck(row, {
        key: "official_site", category: "presence", outcome, severity: "material",
      }));
      continue;
    }
    if (observation.type === "active_commercial_presence") {
      const outcome = observation.active === true ? "pass" : "unknown";
      const row = observationEvidence(
        context.namespace, observation, "website_active_commercial_presence",
        { active: observation.active }, observation.active === null ? 0 : 90,
      );
      evidence.set(row.id, row);
      checks.push(derivedCheck(row, {
        key: "active_commercial_presence", category: "presence", outcome,
        severity: "material",
      }));
      continue;
    }
    if (observation.type === "reachability") {
      const outcome = observation.result === "failure"
        ? "fail"
        : observation.statusCode >= 200 && observation.statusCode <= 399
          ? "pass"
          : observation.statusCode >= 400
            ? "fail"
            : "unknown";
      const value = observation.result === "response"
        ? { result: observation.result, statusCode: observation.statusCode }
        : { result: observation.result, error: observation.error };
      const row = observationEvidence(
        context.namespace, observation, "website_reachable",
        value,
        outcome === "unknown" ? 0 : 95,
      );
      evidence.set(row.id, row);
      checks.push(derivedCheck(row, {
        key: "reachable", category: "reliability", outcome,
        severity: "material",
      }));
      continue;
    }
    if (observation.type === "secure_transport") {
      const outcome = observation.state === "valid"
        ? "pass" : observation.state === "invalid" ? "fail" : "unknown";
      const row = observationEvidence(
        context.namespace, observation, "website_secure_transport",
        { state: observation.state }, outcome === "unknown" ? 0 : 95,
      );
      evidence.set(row.id, row);
      checks.push(derivedCheck(row, {
        key: "secure_transport", category: "security", outcome, severity: "material",
      }));
      continue;
    }
    if (observation.type === "domain_operational") {
      const outcome = observation.state === "operational"
        ? "pass" : observation.state === "failed" ? "fail" : "unknown";
      const row = observationEvidence(
        context.namespace, observation, "website_domain_operational",
        { state: observation.state }, outcome === "unknown" ? 0 : 95,
      );
      evidence.set(row.id, row);
      checks.push(derivedCheck(row, {
        key: "domain_operational", category: "domain", outcome,
        severity: outcome === "fail" ? "critical" : "material",
      }));
      continue;
    }
    if (observation.type === "page_integrity") {
      const outcome = observation.checkedPages === 0
        ? "unknown" : observation.brokenPages === 0 ? "pass" : "fail";
      const row = observationEvidence(
        context.namespace, observation, "website_page_integrity",
        { checkedPages: observation.checkedPages, brokenPages: observation.brokenPages },
        outcome === "unknown" ? 0 : 95,
      );
      evidence.set(row.id, row);
      checks.push(derivedCheck(row, {
        key: "page_integrity", category: "reliability", outcome,
        severity: outcome === "fail" && observation.brokenPages === observation.checkedPages
          ? "critical" : "material",
      }));
      continue;
    }
    if (observation.type === "critical_content") {
      const outcome = observation.missingItems.length === 0 ? "pass" : "fail";
      const row = observationEvidence(
        context.namespace, observation, "website_critical_content",
        { requiredItems: observation.requiredItems, missingItems: observation.missingItems }, 95,
      );
      evidence.set(row.id, row);
      checks.push(derivedCheck(row, {
        key: "critical_content", category: "content", outcome,
        severity: observation.missingItems.length === observation.requiredItems.length
          ? "critical" : "material",
      }));
      continue;
    }
    if (observation.type === "navigation") {
      const outcome = observation.testedPaths === 0
        ? "unknown" : observation.brokenPaths === 0 ? "pass" : "fail";
      const row = observationEvidence(
        context.namespace, observation, "website_navigation",
        { testedPaths: observation.testedPaths, brokenPaths: observation.brokenPaths },
        outcome === "unknown" ? 0 : 95,
      );
      evidence.set(row.id, row);
      checks.push(derivedCheck(row, {
        key: "navigation", category: "usability", outcome,
        severity: outcome === "fail" && observation.brokenPaths === observation.testedPaths
          ? "critical" : "material",
      }));
      continue;
    }
    if (observation.type === "critical_information_freshness") {
      const outcome = observation.checkedCriticalItems === 0
        ? "unknown" : observation.staleCriticalItems === 0 ? "pass" : "fail";
      const row = observationEvidence(
        context.namespace, observation, "website_critical_information_freshness",
        {
          checkedCriticalItems: observation.checkedCriticalItems,
          staleCriticalItems: observation.staleCriticalItems,
        },
        outcome === "unknown" ? 0 : 90,
      );
      evidence.set(row.id, row);
      checks.push(derivedCheck(row, {
        key: "critical_information_freshness", category: "freshness", outcome,
        severity: "material",
      }));
      continue;
    }
    if (observation.type === "presence_consistency") {
      const outcome = observation.checkedProfiles === 0
        ? "unknown" : observation.conflictingProfiles === 0 ? "pass" : "fail";
      const row = observationEvidence(
        context.namespace, observation, "website_presence_consistency",
        {
          checkedProfiles: observation.checkedProfiles,
          conflictingProfiles: observation.conflictingProfiles,
        },
        outcome === "unknown" ? 0 : 90,
      );
      evidence.set(row.id, row);
      checks.push(derivedCheck(row, {
        key: "presence_consistency", category: "credibility", outcome,
        severity: "material",
      }));
      continue;
    }
    const row = observationEvidence(
      context.namespace, observation, "website_subjective_note",
      { key: observation.key, note: observation.note }, 0,
    );
    evidence.set(row.id, row);
    checks.push(derivedCheck(row, {
      key: observation.key,
      category: "presentation",
      outcome: "unknown",
      severity: "informational",
    }));
  }

  return {
    checks: checks.sort((left, right) => checkIdentity(left).localeCompare(checkIdentity(right))),
    evidence: [...evidence.values()].sort((left, right) => left.id.localeCompare(right.id)),
    allowedWebsiteOrigins: [...allowedWebsiteUrls].sort(),
    contextEvidenceIds: [...contextEvidenceIds].sort(),
  };
}

export function evaluateWebsiteAudit(
  rawChecks: WebsiteAuditCheck[],
  context: WebsiteAuditContext = { website: undefined },
): WebsiteAuditResult {
  const parsed = z.array(websiteAuditCheckSchema)
    .max(maximumWebsiteAuditObservations)
    .parse(rawChecks);
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
  const contextEvidenceIds = z.array(z.string().uuid())
    .max(maximumWebsiteAuditObservations)
    .parse(context.contextEvidenceIds ?? []);
  const evidenceIds = [...new Set([
    ...checks.flatMap((check) => check.evidenceIds),
    ...contextEvidenceIds,
  ])].sort();
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
