-- PACS Operations Module 5 Task 5 — integrity-failure notification test fixture.
-- A synthetic ArchiveJob whose archivePath points at a NON-EXISTENT file, so an
-- on-demand verify fails cleanly ("archive file missing") WITHOUT touching any real
-- archive, DICOM, or clinical data. Distinct fake studyInstanceUid so it never
-- collides with a real study or the no-overwrite-verified guard. Idempotent.
-- Operational job row only. Removes nothing.
DO $$
DECLARE
  v_org text;
BEGIN
  SELECT "organizationId" INTO v_org FROM studies
    WHERE "studyInstanceUid" = '1.2.826.0.1.3680043.8.498.91470081044676016600634571518134190811' LIMIT 1;
  IF v_org IS NULL THEN RAISE NOTICE 'skip: no org'; RETURN; END IF;

  INSERT INTO archive_jobs
    (id, "organizationId", "studyInstanceUid", status, "compressionLevel", "instanceCount",
     sha256, "archivePath", verified, "originalBytes", "compressedBytes",
     "startedAt", "completedAt", "createdAt", "updatedAt")
  VALUES
    ('a5000000-0000-4000-8000-0000000000e1', v_org,
     '9.9.9.9.498.integritytest.000000000000000001', 'COMPLETED', 6, 10,
     'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
     'integrity-test/does-not-exist.zip.gz', false, 1000, 800,
     now() - interval '1 hour', now() - interval '1 hour', now() - interval '1 hour', now())
  ON CONFLICT (id) DO NOTHING;
END $$;
