CREATE OR REPLACE FUNCTION private.guard_lh_source_candidate_provenance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.source_type IS DISTINCT FROM OLD.source_type
     OR NEW.source_identity IS DISTINCT FROM OLD.source_identity
     OR NEW.query IS DISTINCT FROM OLD.query
     OR NEW.raw_record IS DISTINCT FROM OLD.raw_record
     OR NEW.canonical_url IS DISTINCT FROM OLD.canonical_url
     OR NEW.discovered_at IS DISTINCT FROM OLD.discovered_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'LeadHunter source candidate provenance is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guard_lh_source_candidate_provenance()
FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER lh_source_candidates_guard_provenance
BEFORE UPDATE ON public.lh_source_candidates
FOR EACH ROW
EXECUTE FUNCTION private.guard_lh_source_candidate_provenance();
