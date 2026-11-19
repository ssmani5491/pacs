# Advanced Enterprise PACS Viewer — Capability Gap Assessment

**Scope:** Read-only inspection of the actual OHIF/Cornerstone3D integration, DICOMweb proxy, reporting
model, and security controls. No code, config, dependency, or service was modified.

**Classification legend:** VERIFIED IMPLEMENTED · PARTIALLY IMPLEMENTED · AVAILABLE BUT NOT INTEGRATED ·
NOT IMPLEMENTED · NOT TESTED.

---

## 1. Existing architecture (verified, to be preserved)

- `ohif/Dockerfile`: **unmodified upstream OHIF source build**, pinned `v3.13.14`, built with
  `PUBLIC_URL=/viewer/`. No vendored fork, no patched upstream files.
- **Our entire OHIF footprint is three files**: `ohif/Dockerfile`, `ohif/ohif-nginx.conf` (static SPA
  serving), `ohif/app-config.js` (runtime config). **There are no custom OHIF extensions, no custom
  modes, and no custom tool registrations anywhere in this repository.** Every behavior seen in the
  running viewer is **stock OHIF v3.13.14's default `longitudinal` mode** — nothing has been added to
  or removed from it beyond what `app-config.js` configures (data source, workers, prefetch limits,
  `oidc` omitted).
- Backend: `DicomWebController`/`DicomWebService` (authenticated DICOMweb proxy, org-isolated,
  streams Orthanc responses verbatim) + `POST /api/viewer/session` (HttpOnly cookie).
- Launch point: `frontend/src/lib/viewer.ts` → `window.open('/viewer/viewer?StudyInstanceUIDs=...')`,
  called from the RIS Worklist ("Open Study") and the Report Editor ("Open in Viewer").
- **Architecture confirmed intact and will be preserved** by every recommendation below: all phases in
  the roadmap build *within* this same proxy/auth/isolation boundary.

## 2. Area A — Existing viewer capabilities (feature-by-feature)

### Basic image tools
| Feature | Status | Evidence |
|---|---|---|
| Zoom, Pan, Window/Level | VERIFIED IMPLEMENTED | Stock OHIF `longitudinal` mode toolbar; observed working live (screenshots 14–18, Phase 6). |
| Preset windowing (CT presets) | VERIFIED IMPLEMENTED | Phase 6 testing verified Bone 2500/480 preset applied to real HU pixel data. |
| Invert, Rotate, Reset viewport | VERIFIED IMPLEMENTED | Default Cornerstone3D viewport toolbar actions, part of stock mode. |
| Flip | AVAILABLE BUT NOT INTEGRATED | Cornerstone3D supports it; not confirmed on the default toolbar in this build (not independently clicked/tested this session). |
| Magnifier | AVAILABLE BUT NOT INTEGRATED | `@ohif/extension-cornerstone` ships a Magnify tool; not confirmed wired into this mode's toolbar — not observed in any prior test. |
| Image interpolation | NOT TESTED | Cornerstone3D renders with interpolation by default; no explicit toggle observed/tested. |
| Pixel probe | AVAILABLE BUT NOT INTEGRATED | Stock Cornerstone3D tool exists upstream; not confirmed exercised. |
| Stack scrolling | VERIFIED IMPLEMENTED | Core to every prior viewer test (mouse wheel/arrow keys documented and used). |
| Cine playback | PARTIALLY IMPLEMENTED | Toolbar cine control documented (PROGRESS.md Phase 6) but never independently exercised/screenshotted. |
| Adjustable playback FPS | NOT TESTED | No evidence of this control being used. |

### Advanced measurements
| Feature | Status | Evidence |
|---|---|---|
| Length | VERIFIED IMPLEMENTED | Stock `@cornerstonejs/tools` Length tool, standard in the longitudinal mode toolbar. |
| Angle, Cobb angle | AVAILABLE BUT NOT INTEGRATED | Shipped by Cornerstone3D/OHIF's measurement tool set; never exercised in this project. |
| Rectangle/Elliptical ROI | AVAILABLE BUT NOT INTEGRATED | Same — shipped, unexercised. |
| Freehand ROI | AVAILABLE BUT NOT INTEGRATED | Requires `@cornerstonejs/tools` PlanarFreehandROI, present upstream in v3.13.14; not confirmed enabled/tested. |
| Bidirectional measurement | AVAILABLE BUT NOT INTEGRATED | Shipped tool, unexercised. |
| Pixel intensity / HU measurement | PARTIALLY IMPLEMENTED | CT HU-correct rendering was verified (RescaleIntercept applied, Phase 6), which is the *prerequisite* for a correct HU probe tool — the probe tool's UI itself was not independently verified reading a value. |
| Mean/StdDev/Area (ROI stats) | AVAILABLE BUT NOT INTEGRATED | Shipped by the ROI tools; not exercised. |
| Text/Arrow annotations | AVAILABLE BUT NOT INTEGRATED | Shipped by `@cornerstonejs/tools` ArrowAnnotate; not exercised. |
| Measurement persistence | **NOT IMPLEMENTED** | **Verified by schema inspection**: the `Report` Prisma model has no measurement/annotation field, and no backend route stores Cornerstone3D annotation state. OHIF's in-session measurement panel exists (client-side, lost on reload) but there is no server-side persistence path. |

### CT/MRI reconstruction
| Feature | Status | Evidence |
|---|---|---|
| Axial/Coronal/Sagittal MPR | VERIFIED IMPLEMENTED | **Actually demonstrated**: Phase 6 screenshot 16 shows the synthetic volume's bone-ring cross-section correctly resampled in coronal/sagittal — only possible via true 3D volume construction. |
| Oblique MPR | AVAILABLE BUT NOT INTEGRATED | Cornerstone3D's `@cornerstonejs/core` volume viewport supports arbitrary-plane reslicing; the stock MPR mode's crosshair tool allows oblique rotation, but this was not independently exercised/verified in any prior test. |
| 3D volume rendering (ray-cast) | AVAILABLE BUT NOT INTEGRATED | `@cornerstonejs/core` ships a volume 3D viewport (`VolumeViewport3D`) in v3.13.14; stock OHIF's `longitudinal` mode does not expose a 3D-render layout button by default — would need a mode/toolbar addition. Never exercised here. |
| MIP / MinIP / Average IP | AVAILABLE BUT NOT INTEGRATED | Cornerstone3D supports slab projections (`VOLUME_3D` blend modes); not wired into any toolbar in this deployment. |
| Thick slab | AVAILABLE BUT NOT INTEGRATED | Same mechanism as MIP; unexercised. |
| Cross-reference lines | PARTIALLY IMPLEMENTED | Console log from this session's own diagnostic (`No source mapping ... ReferenceLines`) confirms the ReferenceLines tool **is registered** in the running viewer; whether it's actively drawn/synchronized across viewports was not independently verified. |
| Synchronised MPR navigation | PARTIALLY IMPLEMENTED | Implied by the ReferenceLines registration above; not independently click-tested this session. |
| 3D rotation | NOT IMPLEMENTED (no 3D viewport in this mode) | See 3D volume rendering above — there is no 3D viewport to rotate without first adding the layout. |
| Volume presets (CT-Bone, CT-Soft-Tissue, etc. for 3D) | NOT IMPLEMENTED | Dependent on a 3D viewport existing first. |

### Advanced viewing
| Feature | Status | Evidence |
|---|---|---|
| Multiple viewport layouts (1x1/1x2/2x2/3x3/custom) | VERIFIED IMPLEMENTED | Explicitly screenshotted and documented (Phase 6, screenshot 15). |
| Hanging protocols | NOT IMPLEMENTED | PROGRESS.md explicitly states "No custom hanging protocol authored (OHIF defaults)"; `app-config.js` declares `modes: []` with no hanging-protocol config. |
| Prior-study comparison (side-by-side) | PARTIALLY IMPLEMENTED | A second "comparison" study (`CT CHEST PRIOR`, same patient) was deliberately ingested for this purpose (Phase 6 test data), but the actual side-by-side comparison workflow was never independently exercised/screenshotted — only that both studies exist and are visible in the study list. |
| Synchronised scrolling / series sync | AVAILABLE BUT NOT INTEGRATED | Stock OHIF ships a sync-group mechanism; not confirmed configured for this mode. |
| Key images | **NOT IMPLEMENTED** | No backend field/route for key-image flags; stock OHIF's key-image tool (if present) has nowhere to persist to. |
| Bookmarks | NOT IMPLEMENTED | No evidence anywhere. |
| Full-screen mode | AVAILABLE BUT NOT INTEGRATED | Browser-native fullscreen API is typically wired in stock OHIF; not independently tested. |
| Multi-monitor support | NOT TESTED | No test setup had multiple displays; OHIF's multi-monitor feature (where present) was never exercised. |
| Customisable layouts (save/restore) | NOT IMPLEMENTED | No persistence path exists (same gap as hanging protocols). |

## 3. Area B — Advanced DICOM support

| Feature | Status | Rationale |
|---|---|---|
| DICOM SR | AVAILABLE BUT NOT INTEGRATED | Orthanc stores any valid DICOM SOP Class including SR; the DICOMweb proxy passes it through unmodified (verified in `dicomweb.service.ts` — generic subPath passthrough, no SOP-Class filtering). OHIF v3.13.14 ships an SR viewer extension upstream, but **no SR instance has ever been created or tested in this system**, and there is no backend workflow to generate one. |
| DICOM SEG | AVAILABLE BUT NOT INTEGRATED | Same transport path as SR; OHIF ships a segmentation extension upstream; never exercised; no backend segmentation-creation workflow exists. |
| RTSTRUCT / RTDOSE | AVAILABLE BUT NOT INTEGRATED | Transport-layer agnostic (any DICOM SOP Class flows through); OHIF's RT extension exists upstream but is unconfirmed as enabled in this mode; never tested; this project has no radiotherapy test data. |
| PET/CT fusion | NOT IMPLEMENTED | Requires a fusion-capable viewport/mode configuration not present in `app-config.js`; no PET test data with a co-registered CT exists in this project (synthetic data is CT-only). |
| Enhanced CT / Enhanced MR (multiframe, functional groups) | NOT TESTED | No enhanced-multiframe DICOM test data exists; Cornerstone3D v3.13.14 generally supports these SOP Classes, but nothing here has verified it against this deployment's proxy/streaming path. |
| Multiframe DICOM (general) | NOT TESTED | No multiframe test instances exist in the synthetic dataset. |
| Ultrasound cine | NOT TESTED | No ultrasound test data exists (synthetic data is CT only — see PROGRESS.md Phase 6 data generation). |
| Mammography presentation states (GSPS) | NOT IMPLEMENTED | No GSPS instances exist; no backend support to create/store one. |
| DICOM GSPS (general) | NOT IMPLEMENTED | Same as above. |
| ECG waveforms | NOT IMPLEMENTED | No waveform SOP Class test data; OHIF's waveform viewer support (if any, in v3.13.14) is unconfirmed. |

**General rule applied throughout this section:** none of these were "claimed to work because the library supports it" — each is marked AVAILABLE BUT NOT INTEGRATED (transport is DICOM-SOP-Class-agnostic by design) or NOT IMPLEMENTED (no backend path) based on what currently exists, not on OHIF's general feature list.

## 4. Area C — Reporting integration (current state, verified against the schema)

- **"Open in Viewer" from the Report Editor** — VERIFIED IMPLEMENTED (`ReportEditor.tsx:182-183` →
  `openStudyInViewer`). One-way only: opens the correct study in a new tab.
- **Linking measurements to reports** — NOT IMPLEMENTED. `Report` model (schema inspected) has no
  measurement reference field; no API accepts a Cornerstone3D annotation payload.
- **Saving key images** — NOT IMPLEMENTED. No field, no endpoint.
- **Saving annotations** — NOT IMPLEMENTED. Same gap.
- **Linking findings to image references** — NOT IMPLEMENTED. `findings`/`impression` are plain text;
  no structured reference to a SOP Instance UID / frame number.
- **Displaying previous reports** — VERIFIED IMPLEMENTED (Report Editor shows version history +
  addenda chain, Phase 7).
- **Comparing current and previous studies** — PARTIALLY IMPLEMENTED (prior study exists in the
  worklist/viewer study list; no dedicated side-by-side comparison UI confirmed wired).
- **Preliminary/Final status** — VERIFIED IMPLEMENTED (full lifecycle: DRAFT→PRELIMINARY→FINAL→signed,
  Phase 7, tested 18/18).
- **Signed-report protection** — VERIFIED IMPLEMENTED and **must be preserved unchanged**: locked/FINAL
  reports throw `ConflictException` on any edit (`reports.service.ts:208-212,297-298`); addenda are
  separate linked rows. Any future viewer-to-report integration (key images, measurements, SR) **must
  attach to a NEW addendum or a pre-signature draft only** — never to a locked report.
- **DICOM SR generation and storage** — NOT IMPLEMENTED. No code generates a DICOM SR object from
  report content or from viewer measurements; no Orthanc STOW call for this purpose exists.

## 5. Area D — Performance (documented + session-observed, no new stress testing performed)

| Scenario | Status | Evidence |
|---|---|---|
| 2000-instance study, progressive loading | VERIFIED IMPLEMENTED | Phase 6 benchmark: first image 1635ms, progressive ~191/2000 frames in 12s, 30.3MB of ~256MB, 235MB JS heap (documented, and this session's own diagnostic reproduced a fast, clean open of the same study: `studyToFirstImage: 394.95ms`, `scriptToView: 644.89ms` — console-timed, real). |
| GPU acceleration | VERIFIED IMPLEMENTED | This session's console log explicitly shows `CornerstoneRender: using GPU rendering`. |
| 6,600-instance study | **NOT TESTED** | Explicitly never benchmarked (PROGRESS.md Phase 6 "Remaining limitations": "6600-image load not performed... extrapolation only"). |
| Thumbnail generation | VERIFIED IMPLEMENTED | Series thumbnails render in the viewer's left panel (observed this session's screenshot). |
| MPR performance | PARTIALLY VERIFIED | Coronal/sagittal resampling was shown to work (Phase 6); no frame-rate/latency measurement exists. |
| Volume/3D rendering performance | NOT TESTED | No 3D viewport exists to benchmark (see Area A). |
| Network request concurrency | PARTIALLY VERIFIED | `maxNumberOfWebWorkers: 3`, `maxNumRequests` caps configured in `app-config.js`; no load test targeted the viewer specifically (Phase 9's k6 load test targets REST APIs, not DICOMweb/viewer traffic). |
| DICOMweb caching | NOT IMPLEMENTED (server-side) | `nginx.conf`'s `/api/dicom-web/` location sets `proxy_buffering off` for streaming correctness — there is no cache layer; browser caching is OHIF's own default behavior (unconfirmed tuned). |
| Multiple simultaneous viewers | NOT TESTED | No concurrent-viewer-session test exists. |
| Browser memory consumption | PARTIALLY VERIFIED | One data point exists (235MB heap at 2000 instances, Phase 6); no ceiling/leak test performed. |

**Bottleneck identified by inspection (not measured):** the nginx `/api/dicom-web/` location has `proxy_read_timeout 300s` and no response cache — for very large studies (6,600 instances) under concurrent viewer sessions, the backend proxy + Orthanc could become the throughput ceiling; this is an informed projection, not a measured result.

## 6. Area E — Security (reviewed; no weakening recommended or performed)

| Control | Status | Evidence |
|---|---|---|
| Viewer JWT auth (Bearer + cookie fallback) | VERIFIED IMPLEMENTED | `jwt.strategy.ts:34-37` extracts from Bearer header OR the HttpOnly viewer cookie, in that order. |
| HttpOnly viewer cookie | VERIFIED IMPLEMENTED | `dicomweb.controller.ts:54-60`: `httpOnly: true`, `sameSite: 'lax'`, `path: '/'`, 30-min maxAge; this session's own diagnostic confirmed the cookie is actually set (`HTTP 201`, cookie present) and used successfully for an authenticated metadata fetch. |
| QIDO-RS authorization | VERIFIED IMPLEMENTED | Org-scoped allow-set filtering for collection-level study search (`dicomweb.service.ts:109-121`); per-study access asserted via `assertStudyAccess` for any UID-scoped request. |
| WADO-RS authorization | VERIFIED IMPLEMENTED | Same `assertStudyAccess` gate applies to any `/studies/{uid}/...` path, which covers WADO-RS metadata/frame/bulkdata routes. |
| STOW-RS authorization | PARTIALLY IMPLEMENTED | The route is reachable and passed through (`dicomweb.controller.ts:82-83`, `@RequirePermissions(STUDY_VIEW)`) — **STOW uploads require only `study.view`, not a more specific "upload/manage" permission.** This is a gap: a view-only role could, in principle, push new instances through this proxy. (No separate finding ID assigned here; flagged for the independent-audit findings register as a candidate addition.) |
| Organization isolation | VERIFIED IMPLEMENTED | Per-study + collection-level filtering, confirmed in code and (from the independent audit) in a real cross-org browser test (`rad_tcl` sees 0 studies, 403 by UID). |
| Patient-information visibility | VERIFIED IMPLEMENTED | The viewer itself carries no separate patient-gating logic — it inherits RIS-side `patient.view`/org isolation because it can only ever see studies the authenticated user's DICOMweb proxy call is authorized for. |
| Cross-study access | VERIFIED IMPLEMENTED | Same `assertStudyAccess` mechanism; a URL-manipulation attempt (changing the UID in the viewer URL) is blocked server-side, not just hidden client-side (tested in Phase 6: "rad_tcl cannot read a GGH study by UID (URL manipulation blocked)"). |
| Annotation persistence authorization | NOT APPLICABLE (yet) | No annotation persistence exists at all (see Area C) — there is nothing to authorize. This becomes a required control the moment Phase 4/5 of the roadmap adds it. |
| Browser storage / token exposure | VERIFIED IMPLEMENTED (by design) | Orthanc credentials never reach the browser (server-side basic auth header only); the RIS access token used for the viewer session lives in an HttpOnly cookie, not readable by viewer JS. |
| Viewer session expiration | VERIFIED IMPLEMENTED | 30-min cookie maxAge; underlying access-token TTL (15 min default) governs real expiry regardless of cookie maxAge, per the comment in `dicomweb.controller.ts:52-53`. |

**No authentication or authorization weakening is recommended anywhere in this assessment or the roadmap that follows.**

## 7. Area F — UI layout recommendation (assessment only; not implemented)

Stock OHIF's `longitudinal` mode already approximates the requested layout (top toolbar, left series
panel, central viewport grid, right-side measurement panel is togglable). The recommended enterprise
layout is **an incremental extension of the existing mode**, not a replacement:

- **Top toolbar** (extend existing): add MPR-crosshair, 3D-render, and Cine-FPS controls next to the
  existing Zoom/Pan/W-L/Measurement group.
- **Left panel** (extend existing series-thumbnail panel): add a collapsible "Prior Examinations" list
  above or below the current study's series, pulling from the already-available comparison-study data.
- **Central workspace** (extend existing viewport grid): add dedicated MPR (2x2: axial/coronal/sagittal/
  3D) and fusion layout presets as new `hangingProtocol`/layout entries.
- **Right panel** (new, since none exists today): a measurements/annotations list bound to the
  (currently nonexistent) persistence layer from Phase 4/5, plus a "Send to Report" action that creates
  a report addendum reference — never touching a locked/signed report.

This is a **recommendation only**; no UI change was made in this assessment.

## 8. Area G — Technology & dependencies (inspected, not upgraded)

- **OHIF**: v3.13.14, pinned, source-built. No vendored patches.
- **Cornerstone3D**: version is whatever `v3.13.14`'s own `pnpm-lock.yaml` resolved at build time inside
  the OHIF build stage — **this repository does not vendor or pin Cornerstone3D independently**; it is
  an internal dependency of the OHIF release. Exact version was **NOT independently verified** in this
  assessment (would require inspecting the built bundle's lockfile inside the image, which was not done
  to stay strictly read-only on the running container).
- **Extensions/modes**: none custom; whatever ships in stock `v3.13.14`'s default `pnpm run build`
  output (`QUICK_BUILD=true`, which "trims some long-tail work the upstream Dockerfile also skips" per
  the Dockerfile's own comment — this may mean some default OHIF extensions are **not** present in this
  particular build; not independently enumerated).
- **DICOMweb client**: OHIF's own built-in `dicomweb` data source, configured in `app-config.js` for
  `wadors` image/thumbnail rendering, `enableStudyLazyLoad: true`, Orthanc-1.13-compatibility flags.
  No separate custom DICOMweb client exists.
- **Custom viewer components**: **none** (confirmed — see §1, three files total).
- **Package compatibility / upgrade risk**: because this is a pinned source build with no custom patches,
  upgrading OHIF is lower-risk than a forked deployment would be, but `QUICK_BUILD=true` and
  `--no-frozen-lockfile` (noted in the Dockerfile) mean a future rebuild at the same tag is **not
  guaranteed byte-identical** (lockfile drift is explicitly allowed). This is a reproducibility risk
  worth flagging, independent of the viewer-capability work.
- **Licensing**: OHIF is MIT-licensed; Cornerstone3D is MIT-licensed. No proprietary dependency risk
  identified. (Not independently re-verified against the exact resolved dependency tree in this
  assessment — stated from the projects' known public licensing.)

**Recommended additional libraries (none installed in this assessment):**
- For Phase 4 (SR/GSPS): `@cornerstonejs/adapters` / `dicom-microscopy-viewer`-style SR parsing is
  already part of the Cornerstone3D ecosystem OHIF ships with — likely no *new* dependency needed,
  only enabling/configuring the existing extension.
- For Phase 6 (PET fusion): no new dependency anticipated; fusion is a Cornerstone3D viewport
  configuration (multiple volumes in one viewport), not a separate library.
- No licensing-risk library is recommended anywhere in this roadmap.

---

## 9. Executive summary of this assessment

The viewer is a genuinely working, unmodified, properly-secured OHIF v3.13.14 deployment whose observed
capabilities (2D tools, MPR, layouts, org-isolated DICOMweb) are **real and independently reproducible**
— this session's own diagnostic reproduced a clean, fast, GPU-rendered open of a 2000-instance study.
But it is running entirely on **stock defaults**: zero custom extensions, zero measurement/annotation
persistence, zero hanging protocols, zero 3D/MIP rendering, zero advanced-modality support (SR, SEG,
RT, PET fusion, GSPS, waveforms), and the reporting integration is one-way (viewer→report launch only,
nothing comes back). The security model protecting it is solid and should be the template every new
capability is built inside of — not relaxed for convenience, including the one gap worth flagging
(STOW-RS currently needs only `study.view`, not a stricter upload permission).
