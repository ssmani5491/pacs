-- Full-text search support for worklist "Report Content" + patient/description search.
-- Adds a generated tsvector column over studies.search_text and a GIN index.

ALTER TABLE "studies" ADD COLUMN IF NOT EXISTS "search_tsv" tsvector;

CREATE OR REPLACE FUNCTION studies_search_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW."search_tsv" :=
    to_tsvector('simple', coalesce(NEW."searchText", '') || ' ' ||
                          coalesce(NEW."description", '') || ' ' ||
                          coalesce(NEW."accessionNumber", ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS studies_search_tsv_trigger ON "studies";
CREATE TRIGGER studies_search_tsv_trigger
  BEFORE INSERT OR UPDATE ON "studies"
  FOR EACH ROW EXECUTE FUNCTION studies_search_tsv_update();

CREATE INDEX IF NOT EXISTS studies_search_tsv_idx ON "studies" USING GIN ("search_tsv");
