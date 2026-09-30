// @vitest-environment node

import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  leadHunterActivities,
  leadHunterCampaigns,
  leadHunterCampaignVersions,
  leadHunterContacts,
  leadHunterEnrollments,
  leadHunterEvidence,
  leadHunterLeads,
} from "./index";

const tables = [
  leadHunterCampaigns,
  leadHunterCampaignVersions,
  leadHunterLeads,
  leadHunterContacts,
  leadHunterEvidence,
  leadHunterEnrollments,
  leadHunterActivities,
] as const;

describe("LeadHunter schema contract", () => {
  it("exports the campaign and prospect tables", () => {
    expect(tables.map(getTableName)).toEqual([
      "lh_campaigns",
      "lh_campaign_versions",
      "lh_leads",
      "lh_contacts",
      "lh_evidence",
      "lh_enrollments",
      "lh_activity",
    ]);
  });

  it("keeps every table owner-scoped with RLS policies", () => {
    for (const table of tables) {
      const config = getTableConfig(table);
      expect(config.columns.some((column) => column.name === "owner_id")).toBe(true);
      expect(config.policies.map((policy) => policy.name)).toContain(
        `${getTableName(table)}_authenticated_select`,
      );
      expect(config.policies.map((policy) => policy.name)).toContain(
        `${getTableName(table)}_backend_insert`,
      );
    }
  });

  it("prevents duplicate enrollment and campaign versions", () => {
    const enrollmentUniqueNames = getTableConfig(leadHunterEnrollments).uniqueConstraints.map(
      (constraint) => constraint.name,
    );
    const versionUniqueNames = getTableConfig(leadHunterCampaignVersions).uniqueConstraints.map(
      (constraint) => constraint.name,
    );

    expect(enrollmentUniqueNames).toContain("lh_enrollments_campaign_lead_unique");
    expect(versionUniqueNames).toContain("lh_campaign_versions_number_unique");
  });

  it("uses owner-scoped foreign keys for campaign and lead relations", () => {
    const enrollmentForeignKeys = getTableConfig(leadHunterEnrollments).foreignKeys.map(
      (foreignKey) => foreignKey.getName(),
    );

    expect(enrollmentForeignKeys).toContain(
      "lh_enrollments_owner_campaign_campaigns_owner_id_id_fk",
    );
    expect(enrollmentForeignKeys).toContain(
      "lh_enrollments_owner_lead_leads_owner_id_id_fk",
    );
  });
});
