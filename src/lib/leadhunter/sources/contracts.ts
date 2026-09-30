import type {
  LeadHunterSource,
} from "@/lib/leadhunter/contracts";

export type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface InitialSourceCursor {
  state: "initial";
}

export interface NextSourceCursor {
  state: "next";
  value: JsonValue;
}

export interface ExhaustedSourceCursor {
  state: "exhausted";
}

export type SourceCursor =
  | InitialSourceCursor
  | NextSourceCursor
  | ExhaustedSourceCursor;

export type SourceResultCursor = NextSourceCursor | ExhaustedSourceCursor;

export interface SourceCapabilities {
  discovery: boolean;
  enrichment: boolean;
  contactSearch: boolean;
  supportsCursor: boolean;
  live: boolean;
  unavailableReason?: string;
}

export interface SourceQueryCursor {
  source: LeadHunterSource;
  country: string;
  region: string | null;
  industry: string | null;
  query: string;
  cursor: SourceCursor;
}

export interface SourceQueryWorkItem {
  kind: "source_query";
  id: string;
  source: LeadHunterSource;
  country: string;
  region: string | null;
  industry: string | null;
  query: string;
  cursor: SourceCursor;
  geographyEvidence: null;
}

export interface SeedUrlWorkItem {
  kind: "seed_url";
  id: string;
  url: string;
}

export type SearchPlanWorkItem = SourceQueryWorkItem | SeedUrlWorkItem;

export interface SearchPlanBudget {
  maxQueries: number;
  plannedQueries: number;
  maxCandidates: number;
}

export interface SearchPlanningCursor {
  offset: number;
}

export interface LeadHunterSearchPlan {
  planVersion: 1;
  campaignVersion: number;
  budget: SearchPlanBudget;
  work: SearchPlanWorkItem[];
  nextPlanningCursor: SearchPlanningCursor;
  planHash: string;
}

export interface SourceCandidate {
  sourceIdentity: string;
  observedName: string | null;
  observedLocation: string | null;
  publicUrl: string | null;
  metadata: { [key: string]: JsonValue };
}

export interface SourceDiscoveryPage {
  candidates: SourceCandidate[];
  nextCursor: SourceResultCursor;
}

export interface SourceAdapter {
  readonly source: LeadHunterSource;
  readonly capabilities: SourceCapabilities;
  discover(work: SourceQueryWorkItem): Promise<SourceDiscoveryPage>;
}
