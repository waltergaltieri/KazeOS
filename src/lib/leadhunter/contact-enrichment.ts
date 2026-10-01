import { domainToASCII } from "node:url";

import { getDomain } from "tldts";
import { z } from "zod";

const noControlCharacters = (value: string) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value);

function publicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      && !url.username
      && !url.password
      && Boolean(url.hostname);
  } catch {
    return false;
  }
}

const boundedText = (maximum: number) => z.string()
  .trim()
  .min(1)
  .max(maximum)
  .refine(noControlCharacters, "Control characters are not allowed");

const sourceUrlSchema = z.string()
  .max(2_048)
  .refine(noControlCharacters, "Control characters are not allowed")
  .refine(publicHttpUrl, "A public credential-free HTTP(S) URL is required");

export const contactSourceDescriptorSchema = z.object({
  ref: boundedText(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/),
  sourceUrl: sourceUrlSchema,
  sourceType: boundedText(80),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  suppliedAt: z.string().datetime({ offset: true }),
  sourceCandidateId: z.string().uuid().optional(),
}).strict();

export const contactEnrichmentPayloadSchema = z.object({
  leadId: z.string().uuid(),
  sources: z.array(contactSourceDescriptorSchema).min(1).max(25).superRefine(
    (sources, context) => {
      const refs = new Set<string>();
      for (const source of sources) {
        if (refs.has(source.ref)) {
          context.addIssue({
            code: "custom",
            message: "Source refs must be unique",
          });
        }
        refs.add(source.ref);
      }
    },
  ),
}).strict();

const publishedEmailSchema = z.string()
  .min(3)
  .max(254)
  .refine((value) => value === value.trim(), "Published email must be exact")
  .refine(noControlCharacters, "Control characters are not allowed")
  .refine((value) => normalizePublishedEmail(value) !== null, "Invalid email");

export const contactObservationSchema = z.object({
  sourceRef: boundedText(120),
  sourceUrl: sourceUrlSchema,
  observedAt: z.string().datetime({ offset: true }),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  extract: z.string().min(1).max(4_000)
    .refine(noControlCharacters, "Control characters are not allowed"),
  email: publishedEmailSchema,
  firstName: boundedText(120).optional(),
  lastName: boundedText(120).optional(),
  role: boundedText(160).optional(),
  channel: z.literal("email").optional(),
}).strict();

export const contactEnrichmentEnvelopeSchema = z.object({
  observations: z.array(contactObservationSchema).max(50),
}).strict();

export type ContactSourceDescriptor = z.infer<typeof contactSourceDescriptorSchema>;
export type ContactObservation = z.infer<typeof contactObservationSchema>;
export type ContactSourceAuthority = "official" | "strong_resolved" | "unmatched";

export interface TrustedContactSource extends ContactSourceDescriptor {
  authority: ContactSourceAuthority;
}

export type ContactConfidence = "high" | "medium" | "low";

export interface SelectedContact {
  displayEmail: string;
  normalizedEmail: string;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  sourceRef: string;
  sourceUrl: string;
  sourceType: string;
  verifiedAt: string;
  confidence: ContactConfidence;
  confidenceScore: 100 | 75 | 30;
  evidenceRefs: string[];
}

export interface ContactSelection {
  outcome: "selected" | "needs_review" | "no_email";
  chosen: SelectedContact | null;
  alternates: SelectedContact[];
  reasons: string[];
  rejectedCount: number;
}

export interface DeriveContactSelectionInput {
  officialDomain: string | null;
  sources: readonly TrustedContactSource[];
  observations: unknown;
  crossLeadEmails: readonly string[];
}

export function normalizePublishedEmail(value: string): string | null {
  if (value !== value.trim() || /\s/u.test(value) || !noControlCharacters(value)) {
    return null;
  }
  const separator = value.lastIndexOf("@");
  if (separator < 1 || separator === value.length - 1) return null;
  const local = value.slice(0, separator).normalize("NFKC");
  const suppliedDomain = value.slice(separator + 1).normalize("NFC");
  if (
    local.length > 64
    || !/^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~.-]+$/u.test(local)
    || local.startsWith(".")
    || local.endsWith(".")
    || local.includes("..")
  ) return null;
  const asciiDomain = domainToASCII(suppliedDomain).toLowerCase().replace(/\.$/u, "");
  if (
    !asciiDomain
    || asciiDomain.length > 253
    || !asciiDomain.includes(".")
    || asciiDomain.split(".").some((label) => (
      !label
      || label.length > 63
      || !/^[a-z0-9-]+$/u.test(label)
      || label.startsWith("-")
      || label.endsWith("-")
    ))
  ) return null;
  const normalized = `${local.toLocaleLowerCase("und")}@${asciiDomain}`;
  return normalized.length <= 254 ? normalized : null;
}

function registrableDomain(value: string | null): string | null {
  if (!value) return null;
  let hostname = value;
  try {
    hostname = new URL(value).hostname;
  } catch {
    // A persisted lead domain may already be a hostname.
  }
  const ascii = domainToASCII(hostname).toLowerCase().replace(/\.$/u, "");
  return getDomain(ascii, { allowPrivateDomains: true });
}

interface TextSpan {
  start: number;
  end: number;
}

function emailAddressSpans(extract: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const pattern = /[\p{L}\p{N}!#$%&'*+/=?^_`{|}~.-]+@(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]+/gu;
  for (const match of extract.matchAll(pattern)) {
    if (match.index === undefined) continue;
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

function overlaps(left: TextSpan, right: TextSpan): boolean {
  return left.start < right.end && right.start < left.end;
}

function exactSpan(
  extract: string,
  value: string,
  forbiddenSpans: readonly TextSpan[] = [],
): boolean {
  let offset = extract.indexOf(value);
  while (offset >= 0) {
    const before = offset === 0
      ? ""
      : Array.from(extract.slice(0, offset)).at(-1) ?? "";
    const afterOffset = offset + value.length;
    const after = afterOffset >= extract.length
      ? ""
      : Array.from(extract.slice(afterOffset))[0] ?? "";
    const unsafeBoundary = /[\p{L}\p{N}._%+'-]/u;
    const candidate = { start: offset, end: offset + value.length };
    const outsideForbiddenSpans = forbiddenSpans.every((span) => (
      !overlaps(candidate, span)
    ));
    if (
      outsideForbiddenSpans
      && (!before || !unsafeBoundary.test(before))
      && (!after || !unsafeBoundary.test(after))
    ) {
      return true;
    }
    offset = extract.indexOf(value, offset + 1);
  }
  return false;
}

function normalizedPersonPart(value: string | null): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("und")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const decisionRolePattern = /\b(owner|founder|co[- ]?founder|ceo|chief executive|president|managing director|general manager|proprietor|due[ñn]o|fundador|fundadora|presidente|gerente general|director ejecutivo|directora ejecutiva)\b/iu;
const genericMailboxPattern = /^(info|hello|hola|contact|contacto|sales|ventas|admin|office|support|soporte|team|equipo)$/iu;

function roleRank(contact: SelectedContact): number {
  if (contact.role && decisionRolePattern.test(contact.role)) return 2;
  if (contact.firstName || contact.lastName) return 1;
  return 0;
}

function genericMailbox(contact: SelectedContact): boolean {
  return genericMailboxPattern.test(contact.normalizedEmail.split("@")[0] ?? "");
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function deterministicContactKey(contact: SelectedContact): string {
  return JSON.stringify([
    contact.displayEmail.normalize("NFC"),
    contact.firstName?.normalize("NFC") ?? "",
    contact.lastName?.normalize("NFC") ?? "",
    contact.role?.normalize("NFC") ?? "",
    contact.sourceUrl,
    contact.sourceType,
    contact.verifiedAt,
    contact.evidenceRefs,
  ]);
}

function comparison(left: SelectedContact, right: SelectedContact): number {
  return right.confidenceScore - left.confidenceScore
    || roleRank(right) - roleRank(left)
    || Number(genericMailbox(left)) - Number(genericMailbox(right))
    || compareText(left.normalizedEmail, right.normalizedEmail)
    || compareText(left.sourceRef, right.sourceRef)
    || compareText(deterministicContactKey(left), deterministicContactKey(right));
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
}

function selectBestObservation(
  observations: Array<{ observation: ContactObservation; source: TrustedContactSource }>,
): SelectedContact {
  const ranked = observations.map(({ observation, source }) => {
    const normalizedEmail = normalizePublishedEmail(observation.email)!;
    const emailDomain = registrableDomain(normalizedEmail.split("@")[1] ?? null);
    const officialDomain = source.authority === "official"
      ? registrableDomain(source.sourceUrl)
      : null;
    const official = source.authority === "official"
      && emailDomain !== null
      && emailDomain === officialDomain;
    const confidence = official
      ? "high" as const
      : source.authority === "strong_resolved"
        ? "medium" as const
        : "low" as const;
    const confidenceScore = confidence === "high" ? 100 as const
      : confidence === "medium" ? 75 as const : 30 as const;
    return {
      displayEmail: observation.email,
      normalizedEmail,
      firstName: observation.firstName ?? null,
      lastName: observation.lastName ?? null,
      role: observation.role ?? null,
      sourceRef: source.ref,
      sourceUrl: source.sourceUrl,
      sourceType: source.sourceType,
      verifiedAt: source.suppliedAt,
      confidence,
      confidenceScore,
      evidenceRefs: [] as string[],
    } satisfies SelectedContact;
  }).sort(comparison);
  const best = ranked[0]!;
  return {
    ...best,
    evidenceRefs: uniqueSorted(observations.map(({ source }) => source.ref)),
  };
}

export function deriveContactSelection(
  input: DeriveContactSelectionInput,
): ContactSelection {
  const parsed = contactEnrichmentEnvelopeSchema.safeParse({ observations: input.observations });
  if (!parsed.success) {
    return {
      outcome: "needs_review",
      chosen: null,
      alternates: [],
      reasons: ["invalid_contact_observations"],
      rejectedCount: Array.isArray(input.observations) ? input.observations.length : 1,
    };
  }

  const sourceMap = new Map(input.sources.map((source) => [source.ref, source]));
  const accepted: Array<{ observation: ContactObservation; source: TrustedContactSource }> = [];
  const reasons: string[] = [];
  let rejectedCount = 0;
  for (const observation of parsed.data.observations) {
    const source = sourceMap.get(observation.sourceRef);
    if (
      !source
      || observation.sourceUrl !== source.sourceUrl
      || observation.observedAt !== source.suppliedAt
      || observation.contentSha256 !== source.contentSha256
    ) {
      rejectedCount += 1;
      reasons.push("source_provenance_mismatch");
      continue;
    }
    if (!exactSpan(observation.extract, observation.email)) {
      rejectedCount += 1;
      reasons.push("email_not_exactly_published");
      continue;
    }
    const personFields = [observation.firstName, observation.lastName, observation.role]
      .filter((value): value is string => value !== undefined);
    const emailSpans = emailAddressSpans(observation.extract);
    if (personFields.some((value) => (
      !exactSpan(observation.extract, value, emailSpans)
    ))) {
      rejectedCount += 1;
      reasons.push("person_field_not_exactly_published");
      continue;
    }
    accepted.push({ observation, source });
  }

  const grouped = new Map<
    string,
    Array<{ observation: ContactObservation; source: TrustedContactSource }>
  >();
  for (const item of accepted) {
    const normalized = normalizePublishedEmail(item.observation.email)!;
    const group = grouped.get(normalized) ?? [];
    group.push(item);
    grouped.set(normalized, group);
  }

  const contacts: SelectedContact[] = [];
  let identityConflict = false;
  for (const observations of grouped.values()) {
    const identities = uniqueSorted(observations.map(({ observation }) => [
      normalizedPersonPart(observation.firstName ?? null),
      normalizedPersonPart(observation.lastName ?? null),
    ].filter(Boolean).join(" ")).filter(Boolean));
    const rolesByPersonAndSource = new Map<string, Set<string>>();
    for (const { observation, source } of observations) {
      const person = [
        normalizedPersonPart(observation.firstName ?? null),
        normalizedPersonPart(observation.lastName ?? null),
      ].filter(Boolean).join(" ");
      const role = normalizedPersonPart(observation.role ?? null);
      if (!role) continue;
      const key = `${source.ref}\u0000${person}`;
      const roles = rolesByPersonAndSource.get(key) ?? new Set<string>();
      roles.add(role);
      rolesByPersonAndSource.set(key, roles);
    }
    const conflictingRoles = [...rolesByPersonAndSource.values()]
      .some((roles) => roles.size > 1);
    if (identities.length > 1 || conflictingRoles) identityConflict = true;
    contacts.push(selectBestObservation(observations));
  }
  contacts.sort(comparison);

  const personEmails = new Map<string, Set<string>>();
  for (const contact of contacts) {
    const person = [
      normalizedPersonPart(contact.firstName),
      normalizedPersonPart(contact.lastName),
    ].filter(Boolean).join(" ");
    if (!person) continue;
    const emails = personEmails.get(person) ?? new Set<string>();
    emails.add(contact.normalizedEmail);
    personEmails.set(person, emails);
  }
  const personAddressConflict = [...personEmails.values()].some((emails) => emails.size > 1);
  const crossLead = new Set(input.crossLeadEmails
    .map(normalizePublishedEmail)
    .filter((email): email is string => email !== null));
  const crossLeadConflict = contacts.some(({ normalizedEmail }) => crossLead.has(normalizedEmail));
  const top = contacts[0];
  const next = contacts[1];
  const ambiguousDecisionContacts = Boolean(
    top
    && next
    && roleRank(top) === 2
    && roleRank(next) === 2
    && top.confidenceScore === next.confidenceScore
    && top.normalizedEmail !== next.normalizedEmail,
  );

  if (identityConflict) reasons.push("conflicting_contact_identity");
  if (personAddressConflict) reasons.push("conflicting_person_addresses");
  if (ambiguousDecisionContacts) reasons.push("ambiguous_decision_contacts");
  if (crossLeadConflict) reasons.push("cross_lead_email_collision");
  const conflict = identityConflict || personAddressConflict
    || ambiguousDecisionContacts || crossLeadConflict;
  if (conflict) {
    return {
      outcome: "needs_review",
      chosen: null,
      alternates: contacts,
      reasons: uniqueSorted(reasons),
      rejectedCount,
    };
  }
  if (!top) {
    return {
      outcome: "no_email",
      chosen: null,
      alternates: [],
      reasons: uniqueSorted(reasons.length > 0 ? reasons : ["no_published_email"]),
      rejectedCount,
    };
  }
  if (top.confidence === "low") {
    reasons.push("unmatched_source_requires_review");
    return {
      outcome: "needs_review",
      chosen: null,
      alternates: contacts,
      reasons: uniqueSorted(reasons),
      rejectedCount,
    };
  }

  const expectedOfficialDomain = registrableDomain(input.officialDomain);
  if (
    top.confidence === "high"
    && expectedOfficialDomain !== null
    && registrableDomain(top.sourceUrl) !== expectedOfficialDomain
  ) {
    return {
      outcome: "needs_review",
      chosen: null,
      alternates: contacts,
      reasons: uniqueSorted([...reasons, "official_domain_mismatch"]),
      rejectedCount,
    };
  }

  return {
    outcome: "selected",
    chosen: top,
    alternates: contacts.slice(1),
    reasons: uniqueSorted(reasons),
    rejectedCount,
  };
}
