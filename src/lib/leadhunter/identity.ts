export type IdentityOutcome =
  | "same_business"
  | "different_business"
  | "needs_review";

export type IdentityUrlRole =
  | "official_website"
  | "directory"
  | "social_profile";

export type OrganizationRole = "branch" | "parent" | "independent" | "unknown";

export interface BusinessIdentity {
  name: string | null;
  emails: readonly string[];
  urls: readonly { url: string; role: IdentityUrlRole }[];
  location: {
    countryCode?: string | null;
    city?: string | null;
    address?: string | null;
  };
  organizationRole: OrganizationRole;
  parentName?: string | null;
}

export type IdentitySignalCode =
  | "normalized_name_match"
  | "normalized_name_similar"
  | "normalized_name_conflict"
  | "normalized_email_match"
  | "official_registrable_domain_match"
  | "country_match"
  | "country_conflict"
  | "city_match"
  | "city_conflict"
  | "address_match"
  | "address_conflict"
  | "branch_parent_ambiguity";

export interface IdentitySignal {
  code: IdentitySignalCode;
  effect: "match" | "conflict" | "review";
}

export interface IdentityResolution {
  outcome: IdentityOutcome;
  signals: readonly IdentitySignal[];
  reasons: readonly IdentitySignalCode[];
}

const organizationSuffixes = new Set([
  "co",
  "company",
  "corp",
  "corporation",
  "inc",
  "incorporated",
  "ltd",
  "llc",
  "sa",
  "srl",
  "sas",
]);

const compoundPublicSuffixes = new Set([
  "com.ar",
  "net.ar",
  "org.ar",
  "gob.ar",
  "gov.ar",
  "edu.ar",
  "co.uk",
  "com.au",
  "com.br",
  "com.mx",
]);

const sharedProfileAndDirectoryHosts = new Set([
  "blogspot.com",
  "facebook.com",
  "github.io",
  "google.com",
  "instagram.com",
  "linkedin.com",
  "myshopify.com",
  "paginasamarillas.com.ar",
  "tripadvisor.com",
  "wixsite.com",
  "wordpress.com",
  "yelp.com",
  "yellowpages.com",
]);

export function normalizeIdentityText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeIdentityEmail(value: string): string {
  return value.trim().toLowerCase();
}

function comparableName(value: string | null): string[] {
  return normalizeIdentityText(value)
    .split(" ")
    .filter((token) => token && !organizationSuffixes.has(token));
}

function nameSignal(
  candidate: BusinessIdentity,
  existing: BusinessIdentity,
): IdentitySignal | null {
  const candidateName = normalizeIdentityText(candidate.name);
  const existingName = normalizeIdentityText(existing.name);
  if (!candidateName || !existingName) return null;
  if (candidateName === existingName) {
    return { code: "normalized_name_match", effect: "match" };
  }

  const candidateTokens = comparableName(candidate.name);
  const existingTokens = comparableName(existing.name);
  if (candidateTokens.length === 0 || existingTokens.length === 0) return null;
  const candidateSet = new Set(candidateTokens);
  const existingSet = new Set(existingTokens);
  const intersection = [...candidateSet].filter((token) => existingSet.has(token)).length;
  const union = new Set([...candidateSet, ...existingSet]).size;
  if (intersection / union >= 2 / 3) {
    return { code: "normalized_name_similar", effect: "review" };
  }
  return { code: "normalized_name_conflict", effect: "conflict" };
}

export function registrableDomainForOfficialUrl(urlValue: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(urlValue).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
  if ([...sharedProfileAndDirectoryHosts].some((sharedHost) => (
    hostname === sharedHost || hostname.endsWith(`.${sharedHost}`)
  ))) {
    return null;
  }
  if (/^\d+(?:\.\d+){3}$/.test(hostname)) return null;
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length < 2) return null;
  const suffix = labels.slice(-2).join(".");
  const hasCompoundSuffix = compoundPublicSuffixes.has(suffix)
    || (
      labels.at(-1)?.length === 2
      && ["co", "com", "edu", "gov", "net", "org"].includes(labels.at(-2) ?? "")
    );
  const labelCount = hasCompoundSuffix ? 3 : 2;
  return labels.length >= labelCount ? labels.slice(-labelCount).join(".") : null;
}

function officialDomains(identity: BusinessIdentity): Set<string> {
  return new Set(identity.urls
    .filter(({ role }) => role === "official_website")
    .map(({ url }) => registrableDomainForOfficialUrl(url))
    .filter((domain): domain is string => domain !== null));
}

function sharesValue(left: Set<string>, right: Set<string>): boolean {
  return [...left].some((value) => right.has(value));
}

function normalizedValues(values: readonly string[]): Set<string> {
  return new Set(values.map(normalizeIdentityEmail).filter(Boolean));
}

function locationSignal(
  code: "country" | "city" | "address",
  candidateValue: string | null | undefined,
  existingValue: string | null | undefined,
): IdentitySignal | null {
  const candidate = normalizeIdentityText(candidateValue);
  const existing = normalizeIdentityText(existingValue);
  if (!candidate || !existing) return null;
  const matches = candidate === existing;
  return {
    code: `${code}_${matches ? "match" : "conflict"}`,
    effect: matches ? "match" : "conflict",
  } as IdentitySignal;
}

function branchParentAmbiguity(
  candidate: BusinessIdentity,
  existing: BusinessIdentity,
): boolean {
  if (
    (candidate.organizationRole === "branch" && existing.organizationRole === "parent")
    || (candidate.organizationRole === "parent" && existing.organizationRole === "branch")
  ) {
    return true;
  }

  const candidateParent = normalizeIdentityText(candidate.parentName);
  const existingParent = normalizeIdentityText(existing.parentName);
  const candidateName = normalizeIdentityText(candidate.name);
  const existingName = normalizeIdentityText(existing.name);
  return Boolean(
    (candidateParent && candidateParent === existingName)
    || (existingParent && existingParent === candidateName),
  );
}

export function resolveBusinessIdentity(
  candidate: BusinessIdentity,
  existing: BusinessIdentity,
): IdentityResolution {
  const signals: IdentitySignal[] = [];
  const candidateEmails = normalizedValues(candidate.emails);
  const existingEmails = normalizedValues(existing.emails);
  const candidateDomains = officialDomains(candidate);
  const existingDomains = officialDomains(existing);
  const names = nameSignal(candidate, existing);
  if (names) signals.push(names);
  if (sharesValue(candidateEmails, existingEmails)) {
    signals.push({ code: "normalized_email_match", effect: "match" });
  }
  if (sharesValue(candidateDomains, existingDomains)) {
    signals.push({ code: "official_registrable_domain_match", effect: "match" });
  }

  const country = locationSignal(
    "country",
    candidate.location.countryCode,
    existing.location.countryCode,
  );
  const city = locationSignal("city", candidate.location.city, existing.location.city);
  const address = locationSignal(
    "address",
    candidate.location.address,
    existing.location.address,
  );
  if (country) signals.push(country);
  if (city) signals.push(city);
  if (address) signals.push(address);
  if (branchParentAmbiguity(candidate, existing)) {
    signals.push({ code: "branch_parent_ambiguity", effect: "review" });
  }

  const reasonSet = new Set(signals.map(({ code }) => code));
  const hasStrongMatch = reasonSet.has("normalized_email_match")
    || reasonSet.has("official_registrable_domain_match");
  const hasNameMatch = reasonSet.has("normalized_name_match")
    || reasonSet.has("normalized_name_similar");
  const hasLocationConflict = reasonSet.has("country_conflict")
    || reasonSet.has("city_conflict")
    || reasonSet.has("address_conflict");

  let outcome: IdentityOutcome;
  if (reasonSet.has("branch_parent_ambiguity")) {
    outcome = "needs_review";
  } else if (reasonSet.has("country_conflict") && hasNameMatch && !hasStrongMatch) {
    outcome = "different_business";
  } else if (hasLocationConflict && (hasNameMatch || hasStrongMatch)) {
    outcome = "needs_review";
  } else if (hasStrongMatch) {
    outcome = "same_business";
  } else if (hasNameMatch) {
    outcome = "needs_review";
  } else {
    outcome = "different_business";
  }

  return {
    outcome,
    signals,
    reasons: signals.map(({ code }) => code),
  };
}
