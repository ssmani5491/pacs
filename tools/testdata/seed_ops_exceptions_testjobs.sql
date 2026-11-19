-- PACS Operations Module 5 — Exceptions console test fixtures.
-- Synthetic OPERATIONAL JOB rows only (dicom_transfer_jobs). These are NOT clinical
-- data, NOT DICOM instances, NOT archives — they are transfer-job audit rows of the
-- same kind Module 1's own tests create. Idempotent (fixed ids, ON CONFLICT DO
-- NOTHING). Removes nothing. Used by tests/operational-integration.spec.ts to exercise
-- confirmed-failure, partial, and interrupted-heuristic classification. Does not touch
-- archives/reports/signatures/volumes/GIN.
DO $$
DECLARE
  v_org   text;
  v_dest  text;
  -- A real GGH study that Task 3's exact-count tests do NOT assert on (it already
  -- carries the real FAILED archive). Keeps the exceptions fixtures from perturbing
  -- the transfer counts of the Task 3 study.
  v_uid   text := '1.2.826.0.1.3680043.8.498.86314780744282731054603380498190972747';
BEGIN
  SELECT "organizationId" INTO v_org FROM studies WHERE "studyInstanceUid" = v_uid LIMIT 1;
  SELECT id INTO v_dest FROM pacs_destinations LIMIT 1;
  IF v_org IS NULL OR v_dest IS NULL THEN RAISE NOTICE 'skip: no org/destination'; RETURN; END IF;

  -- Confirmed FAILED transfer
  INSERT INTO dicom_transfer_jobs
    (id, "organizationId", "destinationId", "studyInstanceUid", status, "totalInstances",
     "successInstances", "failedInstances", "pendingInstances", "retryCount", "lastError",
     "startedAt", "completedAt", "createdAt", "updatedAt")
  VALUES
    ('e5000000-0000-4000-8000-000000000f01', v_org, v_dest, v_uid, 'FAILED', 100,
     0, 100, 0, 1, 'store failed: association rejected',
     now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours', now())
  ON CONFLICT (id) DO NOTHING;

  -- PARTIALLY_COMPLETED transfer
  INSERT INTO dicom_transfer_jobs
    (id, "organizationId", "destinationId", "studyInstanceUid", status, "totalInstances",
     "successInstances", "failedInstances", "pendingInstances", "retryCount", "lastError",
     "startedAt", "completedAt", "createdAt", "updatedAt")
  VALUES
    ('e5000000-0000-4000-8000-000000000f02', v_org, v_dest, v_uid, 'PARTIALLY_COMPLETED', 100,
     60, 40, 0, 0, '40 of 100 instances rejected',
     now() - interval '3 hours', now() - interval '3 hours', now() - interval '3 hours', now())
  ON CONFLICT (id) DO NOTHING;

  -- Interrupted (RUNNING, startedAt well past the staleness window, no completedAt)
  INSERT INTO dicom_transfer_jobs
    (id, "organizationId", "destinationId", "studyInstanceUid", status, "totalInstances",
     "successInstances", "failedInstances", "pendingInstances", "retryCount",
     "startedAt", "completedAt", "createdAt", "updatedAt")
  VALUES
    ('e5000000-0000-4000-8000-000000000f03', v_org, v_dest, v_uid, 'RUNNING', 100,
     10, 0, 90, 0,
     now() - interval '6 hours', NULL, now() - interval '6 hours', now())
  ON CONFLICT (id) DO NOTHING;
END $$;
