# Advanced Enterprise PACS Viewer — Implementation Roadmap

**Status: PROPOSAL ONLY. Not approved. No phase has been implemented.**
Companion to `ADVANCED_VIEWER_CAPABILITY_ASSESSMENT.md` — read that first; every gap referenced below
is cited from that assessment, not assumed.

**Standing constraints for every phase** (carried from the assessment and the project's existing rules):
preserve the 8-service architecture; no new Docker service unless separately justified; additive
migrations only; preserve `studies_search_tsv_idx`; preserve signed-report immutability (new
viewer-sourced content attaches only to a draft or a new addendum, never to a locked report); preserve
organization isolation and the existing DICOMweb auth model; no credential/token exposure to viewer JS;
build *within* the existing proxy, not around it.

---

## Phase 1 — Advanced 2D tools and measurements

**Goal:** close the gaps marked AVAILABLE BUT NOT INTEGRATED / NOT IMPLEMENTED in Area A's "basic
tools" and "advanced measurements" tables — enable the Cornerstone3D tools OHIF already ships, and add
the one missing piece: server-side measurement persistence.

- **Backend changes:** new `MeasurementsService` + table (additive migration) storing
  `{studyInstanceUid, sopInstanceUid, frameNumber?, toolType, data(JSON), createdBy, organizationId,
  createdAt}`, org-scoped, `study.view`-gated for read, a narrower `measurement.create`-style
  permission for write (new permission — requires separate approval per the project's permission
  rules). `GET/POST /api/pacs/viewer/measurements?studyInstanceUid=`.
- **Frontend changes:** enable Angle/Cobb/ROI/Freehand/Bidirectional/Arrow/Text-annotation tools in the
  OHIF toolbar config (`app-config.js` + a minimal custom extension registering the tool group — this
  is the first file beyond the current three-file footprint); wire OHIF's measurement-service
  save/load hooks to the new API instead of only in-memory state; add Magnifier, Pixel Probe, HU
  readout, Flip, adjustable Cine FPS to the toolbar.
- **DICOM requirements:** none beyond what's already proxied — these tools operate on pixel data
  already retrievable.
- **Security requirements:** new `measurement.create`/`measurement.view` permissions, org-isolated,
  audited (`VIEWER_MEASUREMENT_CREATE`); never writable against a locked report's study without an
  explicit addendum context.
- **Testing requirements:** Playwright: create a measurement, reload the viewer, confirm it persists;
  org-isolation test (cross-org user cannot read/write another org's measurements); permission-denial
  test (view-only role cannot write); HU-probe value sanity-checked against the synthetic volume's known
  `RescaleIntercept`.
- **Dependencies:** none beyond Cornerstone3D's already-bundled tool classes (per the assessment, no
  new external library is anticipated).
- **Risks:** this phase's custom extension is the project's first departure from "stock OHIF,
  zero customization" — increases future-upgrade friction; mitigate by keeping the extension minimal
  (tool registration + a save/load adapter, not a UI rewrite).
- **Acceptance criteria:** every "basic tool" and "advanced measurement" row in the assessment's Area A
  tables that is not already VERIFIED IMPLEMENTED reaches VERIFIED IMPLEMENTED with a reproducible test;
  measurements survive a page reload; org isolation holds.

## Phase 2 — Advanced MPR and 3D volume rendering

**Goal:** close the Area A "CT/MRI reconstruction" gaps — oblique MPR, 3D volume rendering, MIP/MinIP/
average-IP, thick slab, volume presets.

- **Backend changes:** none required for rendering itself (volumes are constructed client-side from
  the already-streamed slice data); optionally a `GET /api/pacs/viewer/volume-presets` config endpoint
  if presets should be org-configurable rather than hardcoded.
- **Frontend changes:** add a 3D/MPR layout button and mode configuration enabling
  `VolumeViewport3D` + slab blend modes (MIP/MinIP/Average) via Cornerstone3D's existing volume
  viewport APIs; wire crosshair-driven oblique reslicing; add a volume-preset picker (CT-Bone,
  CT-Soft-Tissue, etc. — Cornerstone3D ships standard presets).
- **DICOM requirements:** requires a reconstructible volume (consistent slice spacing/orientation) —
  already true for the existing synthetic CT test data; real clinical multi-series/irregular-spacing
  studies may need a validation step before volume construction (flag malformed geometry rather than
  silently rendering wrong).
- **Security requirements:** none beyond Phase 1's inherited model — rendering is client-side on
  already-authorized pixel data.
- **Testing requirements:** visual verification (screenshot) that 3D rendering shows a recognizable
  shape from the synthetic volume's known geometry; MIP over a known HU range shows the expected
  bright structures; performance timing captured (not just pass/fail) for the existing 2000-instance
  study, extended to the still-NOT-TESTED 6,600-instance scenario this phase should finally exercise.
- **Dependencies:** Cornerstone3D's volume/3D viewport (already bundled per the assessment — no new
  package anticipated, pending independent confirmation of the exact bundled Cornerstone3D version,
  which Phase 1's work should establish).
- **Risks:** 3D/volume rendering is the most GPU/memory-intensive addition — the assessment's Area D
  flagged this as NOT TESTED; this phase must include an actual measurement (not an estimate) before
  sign-off. Large studies may need a volume-size cap or a progressive/lower-resolution 3D preview.
- **Acceptance criteria:** oblique MPR, 3D render, and at least one slab-projection mode each produce a
  correct, screenshotted result on the existing synthetic volume; a documented, measured (not estimated)
  performance figure exists for 3D rendering at 2000 instances; 6,600-instance 3D rendering is at least
  attempted and its real result (pass, degrade, or fail) is reported honestly.

## Phase 3 — Hanging protocols and prior-study comparison

**Goal:** close "hanging protocols," "prior-study comparison," "synchronised scrolling," and
"customisable layouts" (all NOT IMPLEMENTED / PARTIALLY IMPLEMENTED per the assessment).

- **Backend changes:** none required for OHIF-native hanging protocols (they're a frontend
  configuration construct); if per-organization custom protocols are wanted, an additive
  `HangingProtocolConfig` table + `pacs.viewer.manage`-gated CRUD (new permission, separate approval).
- **Frontend changes:** author at least one real hanging protocol (e.g., "current + prior side-by-side
  for the same modality") using OHIF's hanging-protocol JSON format; wire the comparison-study lookup
  (the backend already has the data — Study↔Patient relationship — to find same-patient priors) into
  the viewer's study-selection; enable sync-groups for scroll/W-L/zoom across linked viewports.
- **DICOM requirements:** requires at least two studies for the same patient to exist — already true
  for the project's synthetic "CT CHEST VOLUME" + "CT CHEST PRIOR" pair; no new DICOM capability needed.
- **Security requirements:** the prior-study lookup must respect the same organization isolation as
  every other study access — reuse `assertStudyAccess`, do not introduce a second, parallel lookup path
  that bypasses it.
- **Testing requirements:** Playwright test opening the current+prior pair side-by-side; confirm
  synchronized scroll moves both viewports; confirm a cross-org user cannot pull a same-MRN prior from
  another organization (this is a new attack surface the current single-study model doesn't have —
  must be explicitly tested, not assumed safe).
- **Dependencies:** none beyond OHIF's built-in hanging-protocol engine.
- **Risks:** a same-patient cross-org prior-study lookup is the one place this phase could
  **accidentally weaken** isolation if implemented carelessly (e.g., matching priors by MRN without an
  org filter) — call this out explicitly in code review, not just testing.
- **Acceptance criteria:** at least one working hanging protocol demonstrated end-to-end; prior-study
  comparison with synchronized navigation demonstrated; a dedicated cross-org prior-study isolation test
  passes.

## Phase 4 — Advanced annotations, GSPS, and DICOM SR

**Goal:** close the Area B advanced-DICOM gaps that are feasible without new clinical hardware/data
(SR, GSPS) and extend Phase 1's measurement persistence into standards-based DICOM objects.

- **Backend changes:** a `DicomSrService` that can (a) *read* any SR/GSPS instance already in Orthanc
  via the existing proxy (no change needed — transport already passes any SOP Class) and (b)
  optionally *generate* a DICOM SR from the Phase 1 measurement records and STOW it back to Orthanc
  under the same study (new, carefully-scoped write path — requires a new permission and must not be
  confused with the clinical report's own immutability rules; an SR is evidence attached to the study,
  not the signed report).
- **Frontend changes:** enable OHIF's SR/GSPS viewer extension(s) if present in the pinned build
  (confirm first — the assessment flagged `QUICK_BUILD=true` as a reason some upstream extensions may
  not be present); render SR findings as an annotation overlay; a "Save as SR" action from the
  Phase-1 measurement panel.
- **DICOM requirements:** needs test SR/GSPS instances — none exist today (Area B: NOT TESTED). This
  phase must first generate or synthesize valid test objects before any claim of support is made.
- **Security requirements:** new SR-write permission, org-isolated, audited; SR generation must be
  idempotent (no duplicate SOP Instances on retry) and must never retroactively alter an already-stored
  SR (append a new one instead, mirroring the report-addendum pattern).
- **Testing requirements:** round-trip test — create measurements, generate SR, STOW it, re-query via
  QIDO, confirm it appears and re-renders correctly; confirm it does not appear to a cross-org user.
- **Dependencies:** likely none new (Cornerstone3D/OHIF's DICOM adapters typically include SR parsing);
  to be confirmed once the exact bundled extension set is inspected (deferred from this assessment).
- **Risks:** DICOM SR generation is the most standards-sensitive item in this roadmap — a malformed SR
  could be rejected by Orthanc or (worse) accepted but unreadable by other viewers. Validate against
  Orthanc's own SR support before relying on it.
- **Acceptance criteria:** a measurement round-trips through a real DICOM SR object and is readable
  back in the viewer; GSPS presentation state (if pursued) correctly reapplies a saved W/L/annotation
  state on reload.

## Phase 5 — Reporting integration

**Goal:** close every Area C gap — link measurements/key-images/SR to reports, while **preserving
signed-report immutability without exception**.

- **Backend changes:** extend `Report` (additive columns or a new linked `ReportImageReference` table)
  with references to: key SOP Instance UIDs, Phase-1 measurement IDs, Phase-4 SR instance UIDs. These
  references attach to the **report's current draft/addendum row only** — the existing `locked`/
  `FINAL` guard in `reports.service.ts:208-212` already rejects any write to a signed report, so this
  phase's writes must go through that same guarded path, never around it.
- **Frontend changes:** in the Report Editor, a "findings" section that can pull in a saved measurement
  or key image from the viewer session; in the viewer, a "Send to Report" action that opens/creates the
  relevant draft/addendum rather than writing directly.
- **DICOM requirements:** none beyond Phase 1/4's outputs.
- **Security requirements:** reuse existing report RBAC (`report.edit`, `report.amend`) — no new
  permission needed here if the write path is the existing report-edit/addendum API; audit every link
  creation.
- **Testing requirements:** attempt to link a measurement to a **locked** report and confirm it is
  rejected (`ConflictException`, same as any other locked-report edit) — this is the single most
  important test in this phase; confirm linking succeeds on a draft/addendum.
- **Dependencies:** Phase 1 (measurements) and, for full SR linking, Phase 4.
- **Risks:** the obvious failure mode is a shortcut that writes to a signed report "just this once" —
  explicitly test against it, don't just rely on the existing guard being reused correctly.
- **Acceptance criteria:** a measurement/key-image/SR reference can be attached to a draft or addendum
  and is visible in the signed PDF/version history; the same action against a locked report is
  rejected with the existing immutability error, proven by a passing negative test.

## Phase 6 — Advanced modality support (PET/CT, mammography, radiotherapy)

**Goal:** close the remaining Area B gaps that require new test data and, in PET's case, a fusion
viewport.

- **Backend changes:** none beyond what the existing proxy already passes through; possibly a
  `modality-specific presets` config table if PET SUV/mammography CC-MLO layout presets should be
  org-configurable.
- **Frontend changes:** enable a fusion viewport (multi-volume, PET colorized overlay on CT grayscale)
  — a genuinely new Cornerstone3D viewport configuration, not present in any form today; mammography
  CC/MLO 4-up hanging protocol (extends Phase 3's hanging-protocol work); RTSTRUCT/RTDOSE overlay
  rendering if radiotherapy support is pursued.
- **DICOM requirements:** **this phase cannot start without real or realistic synthetic PET, mammography
  GSPS, and/or RT test data** — none exists today (Area B: NOT TESTED across the board, NOT IMPLEMENTED
  for GSPS). Generating this synthetic data (geometry, SUV scaling, co-registration) is itself
  significant work and should be scoped before committing to a Phase 6 timeline.
- **Security requirements:** none new beyond the inherited model.
- **Testing requirements:** PET/CT fusion alignment must be visually verified against known synthetic
  geometry (same rigor as Phase 6's — i.e., this roadmap's Phase 2 — MPR verification); mammography
  layout verified against the 4-view standard; RT overlay (if pursued) verified against a known
  dose/structure test set.
- **Dependencies:** likely needs a PET-colorization/fusion library if not already bundled with
  Cornerstone3D — **to be confirmed by inspection before this phase is approved**, not assumed.
- **Risks:** this is the highest-uncertainty phase — it depends on synthetic test-data generation this
  roadmap has not yet scoped, and may reveal that the pinned OHIF build (`QUICK_BUILD=true`) lacks an
  extension this phase needs, which could force an OHIF rebuild-config change before any frontend work
  starts.
- **Acceptance criteria:** at minimum, PET/CT fusion renders correctly on a synthetic co-registered
  pair with verified alignment; mammography 4-up hanging protocol works; RT support, if attempted,
  is explicitly marked NOT TESTED / PARTIALLY IMPLEMENTED / VERIFIED IMPLEMENTED honestly rather than
  assumed from Cornerstone3D's general capability.

---

## Cross-phase notes

- **Phase ordering is a dependency chain**, not strictly sequential effort: Phase 1's measurement store
  is a prerequisite for Phases 4 and 5; Phase 2's volume infrastructure is a prerequisite for Phase 6's
  fusion work. Phases 3 and the early parts of Phase 2/4 could proceed in parallel if resourced
  separately.
- **Every phase that adds a write path needs a new, explicitly-approved permission** per this project's
  established rule (no broad permission, server-side RBAC, org isolation) — none should be added
  without the same approval process already used for Modules 1–5.
- **Exact Cornerstone3D version and bundled-extension set should be confirmed (read-only) before Phase 1
  starts** — the capability assessment flagged this as not independently verified; it changes what
  Phase 1 needs to add versus merely enable.

---

**Awaiting approval before implementing Phase 1.** No phase in this roadmap has been started.
