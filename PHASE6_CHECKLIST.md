# Phase 6 Checklist — Advanced PACS Viewer (OHIF + Cornerstone3D) ✅ (2026-11-14)

Legend: [x] done/verified · [~] partial / documented limitation

## Module 1 — OHIF Viewer deployment
- [x] OHIF deployed as a new Docker service (`ohif`), **pinned v3.13.14** (source build)
- [x] Served at `http://localhost/viewer/` (HTTP 200, PUBLIC_URL baked to /viewer/)
- [x] Cornerstone3D active (console: "CornerstoneRender: using GPU rendering")
- [x] Orthanc DICOMweb configured (via authenticated backend proxy)
- [x] Integrated with existing nginx (dynamic-DNS `set $upstream_ohif` pattern)
- [x] Persistent config via mounted `app-config.js` (served no-store)
- [x] Browser caching (immutable hashed assets; no-store config)
- [x] Fully local, no cloud dependencies
- [x] Orthanc admin NOT exposed publicly (no host port for 8042; only server-side proxy)

## Module 2 — DICOMweb integration
- [x] QIDO-RS (study + series search) via proxy — verified
- [x] WADO-RS metadata (300 instances), series, instances — verified
- [x] WADO-RS pixel frame fetch: HTTP 200, 131624 bytes, correct multipart — verified
- [~] STOW-RS: proxy forwards POST/PUT to Orthanc; primary upload path remains the
      Phase 4 C-STORE+ingest flow (OHIF is read-only in this deployment). Not drill-tested.
- [x] DICOM image rendering verified in-browser (axial + MPR)
- [x] No Orthanc credentials in the browser (cookie carries RIS session only)

## Module 3 — RIS worklist integration
- [x] "Open Study" button on each worklist row (enabled only when hasImages)
- [x] Retrieves the study's StudyInstanceUID
- [x] Verifies access: study.view permission (guard) + org ownership (proxy)
- [x] Opens OHIF loaded on the correct study (deep link ?StudyInstanceUIDs=)
- [x] Displays the series (S:1, 300)
- [x] Preserves patient/study context (patient shown, prior studies listed)
- [x] Return to worklist: viewer opens in a new tab; worklist tab remains
- [x] Direct study URL navigation supported (tested by navigating to the UID URL)

## Module 4 — Viewer interface
- [x] Toolbar / left series panel / central viewport / study info / bottom nav
- [x] Layouts: 1x1, 1x2, 2x2, 3x3 (Common) + Custom grid selector
- [x] Multiple series/studies listed; series selection; image scroll; MPR layout

## Module 5 — Image manipulation
- [x] Zoom, Pan, Window/Level, Reset View, Rotate, Capture — toolbar present & active
- [x] Image navigation (scrollbar + I:n/N overlay), cine (tool available), fit/actual
- [~] Invert / flip H/V: available via Cornerstone3D tools; not each click-verified
- [x] Keyboard shortcuts documented (see PROGRESS.md)

## Module 6 — Window/Level presets (verified applying to real HU pixels)
- [x] Soft tissue 400/40, Lung 1500/-600, Liver 150/90, Bone 2500/480, Brain 80/40
- [x] Applied **Bone 2500/480** live → overlay changed to W:2500 L:480 across viewports
- [~] "Abdomen"/"Mediastinum" map to Liver/Soft-tissue presets (OHIF default naming);
      custom WW/WC supported via the Window Level tool drag
- [x] Presets operate on real RescaleIntercept/HU-calibrated pixel data

## Module 7 — Measurement tools
- [x] Length tool present in toolbar; annotation tools provided by Cornerstone3DTools
- [x] Uses real DICOM PixelSpacing (0.7mm) — our volumes carry spacing, so mm are valid
- [~] Full set (Angle/Cobb/Rect/Ellipse/Freehand/Point/area) available in OHIF v3.13;
      Length verified interactively, the rest are the stock Cornerstone3D tools (not each
      click-verified in this pass). No calibrated values are shown when spacing is absent
      (OHIF behaviour).

## Module 8 — Advanced viewing
- [x] **MPR verified real**: 3 orthogonal viewports; coronal/sagittal show the volume's
      sinusoidal bone-ring cross-section — only possible by true 3D resampling
- [x] Axial/coronal/sagittal orientations (A / H+A / H+R markers)
- [~] Crosshairs/cross-reference + sync: tools present (Crosshairs button); enabled in MPR
- [x] Previous-study comparison: prior study (CT CHEST PRIOR, 150) listed for same patient
- [~] Hanging protocols: OHIF default HP engine active (auto axial layout); no custom HP authored
- [x] No fake MPR — reconstruction is genuine Cornerstone3D volume rendering

## Module 9 — Large-study performance (2000-slice study; actual numbers)
- [x] Progressive/lazy loading proven: ~191 of 2000 frames fetched in first 12s (not all)
- [x] First image displayed: **1635 ms** from navigation
- [x] Page DOM ready 99 ms; data transferred 30.3 MB of ~256 MB (no full-study download)
- [x] JS heap 235 MB used / 298 MB total (limit 4192 MB) — healthy
- [~] 6600-image target NOT loaded; benchmarked at **2000 slices** (256x256) honestly.
      Extrapolation + the progressive-loading design indicate 6600 is feasible but it was
      not loaded, so no claim is made beyond the 2000-slice measured result.

## Module 10 — Security
- [x] Authenticated viewer access (401 without token)
- [x] Study-level authorization (per-UID org check in the proxy)
- [x] Organization isolation: rad_tcl sees 0 studies; blocked (403) from a GGH study by UID
- [x] Secure DICOMweb; Orthanc creds server-side only; no hardcoded passwords in browser
- [x] Session validation (HttpOnly cookie carries the RIS JWT; same validation as Bearer)
- [x] Audit logging: VIEWER_SESSION_OPEN, VIEWER_STUDY_OPEN, VIEWER_STUDY_ACCESS_DENIED recorded

## Module 11 — Viewer worklist integration
- [x] Patient demographics, study details, accession, modality, date shown in viewer
- [x] Series list + image count (S:1, 300/150/2000)
- [x] Previous-study navigation (prior study in the study list)
- [x] Return to worklist (separate tab preserved)
- [~] Phase 7 reporting integration points: "Report" button stub present (disabled); no fake report

## Module 12 — Testing (synthetic data only)
- [x] OHIF startup, Orthanc connectivity, QIDO, WADO, study search, series, rendering
- [x] Window/Level, layouts, MPR, previous-study, worklist→viewer, auth, org isolation
- [x] Large-study performance benchmarked
- [x] Container restart (OHIF) + nginx upstream DNS after OHIF deploy — both pass
- [x] **Playwright suite: 4/4 pass** (auth, org-isolation, WADO pixel stream, worklist→OHIF→MPR)

## Development rules
- [x] Phases 1-5 preserved (all endpoints 200; search_tsv GIN intact; 34/34 unit tests)
- [x] No PG reset; no volume deletion; no DICOM-record changes; no migration needed
- [x] Orthanc service unchanged; MWL SCP intact (:4243); nginx dynamic DNS preserved
- [x] Real DICOM images (synthetic volumes with true geometry); no mock viewer data
- [x] No proprietary vendor code/branding (OHIF OSS, our own proxy/UI)
- [x] Versions pinned (ohif v3.13.14, cookie-parser 1.4.7); config changes documented

## Known limitations (carried forward)
- 6600-image load not performed (benchmarked at 2000); extrapolation only.
- Some Module 5/7 tools available but not each individually click-verified this pass.
- No custom hanging protocol authored (OHIF defaults used).
- Orthanc stable-study ingest delay ~60-90s before a new C-STORE study appears in RIS.
- 4 pre-Phase-6 orphan studies have NULL org (from Phase 4 orphan reconciliation) and are
  therefore invisible to org-scoped radiologists by design; new ingests get the correct org.
