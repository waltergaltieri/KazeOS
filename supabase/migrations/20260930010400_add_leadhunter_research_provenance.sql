CREATE TYPE public.lh_evidence_status AS ENUM('verified', 'inferred', 'conflicting');--> statement-breakpoint
ALTER TABLE lh_evidence ADD COLUMN campaign_version integer;--> statement-breakpoint
ALTER TABLE lh_evidence ADD COLUMN question_key text;--> statement-breakpoint
ALTER TABLE lh_evidence ADD COLUMN status public.lh_evidence_status;--> statement-breakpoint
UPDATE lh_evidence
SET status = CASE
  WHEN kind = 'fact' THEN 'verified'::public.lh_evidence_status
  ELSE 'inferred'::public.lh_evidence_status
END
WHERE status IS NULL;--> statement-breakpoint
ALTER TABLE lh_evidence ALTER COLUMN status SET NOT NULL;--> statement-breakpoint
ALTER TABLE lh_evidence ADD CONSTRAINT lh_evidence_campaign_version_coherence
CHECK (
  (campaign_id IS NULL AND campaign_version IS NULL)
  OR (campaign_id IS NOT NULL AND (campaign_version IS NULL OR campaign_version > 0))
);--> statement-breakpoint
ALTER TABLE lh_evidence ADD CONSTRAINT lh_evidence_question_key_format
CHECK (question_key IS NULL OR question_key ~ '^[a-z][a-z0-9_]{1,79}$');--> statement-breakpoint
ALTER TABLE lh_evidence ADD CONSTRAINT lh_evidence_status_kind_coherence
CHECK (
  (status = 'verified' AND kind = 'fact')
  OR (status IN ('inferred', 'conflicting') AND kind = 'hypothesis')
);--> statement-breakpoint
ALTER TABLE lh_evidence ADD CONSTRAINT lh_evidence_owner_campaign_version_campaign_versions_owner_campaign_version_fk
FOREIGN KEY (owner_id,campaign_id,campaign_version)
REFERENCES public.lh_campaign_versions(owner_id,campaign_id,version)
ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX lh_evidence_owner_lead_campaign_version_idx
ON lh_evidence USING btree (owner_id,lead_id,campaign_id,campaign_version);
