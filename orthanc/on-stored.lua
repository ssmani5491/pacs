-- Fires when an Orthanc study becomes stable (no new instances for a while).
-- Notifies the backend ingest endpoint, which pulls metadata via Orthanc's REST
-- API and registers Patient->Study->Series->Instance in the RIS database.

function OnStableStudy(studyId, tags, metadata)
  local payload = DumpJson({ studyId = studyId }, false)
  local secret = os.getenv("INGEST_SECRET") or ""
  -- Defaults to the Compose service name (unchanged dev behavior); the
  -- all-in-one image sets INGEST_BACKEND_URL to http://127.0.0.1:3000 since
  -- there is no Docker-network "backend" hostname inside a single container.
  local backendUrl = os.getenv("INGEST_BACKEND_URL") or "http://backend:3000"
  local headers = {
    ["content-type"] = "application/json",
    ["x-ingest-secret"] = secret,
  }
  local ok, err = pcall(function()
    HttpPost(backendUrl .. "/api/ingest/orthanc-study", payload, headers)
  end)
  if not ok then
    print("on-stored.lua: HttpPost failed: " .. tostring(err))
  end
end
