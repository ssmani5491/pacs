# Reconnaissance Summary — Pixray PACS (RISPACS Enterprise Edition)

Target: Pixray PACS, RISPACS Enterprise Edition, by Teciatric Informatics.
Deployment seen: web app at `172.16.7.82:2000/worklist`, logged in as `admin`.
Stance: clean-room. We rebuild the *functions and workflow*, not vendor code, assets or branding.

## Evidence we actually have

| # | source | what it gave us | confidence |
| --- | --- | --- | --- |
| 1 | Worklist screenshot (own admin account) | full worklist UI, all search fields, modality filters, status tabs, results columns, pagination, left-nav admin tree | HIGH for what's shown |
| 2 | User's confirmations | study arrival, worklist, viewer, reporting, admin all exist | MEDIUM (confirmed existence, not detail) |

Everything below is tagged **CONFIRMED** (seen on screen), **STATED** (you told me it exists),
or **PROPOSED** (standard PACS behaviour I'm assuming because we have no screenshot yet).

## CONFIRMED features (from the worklist screenshot)

- **Worklist** with server-side pagination — "Showing 10 of 48117", page 1 of 4812.
- **Columns:** Action, Patient ID, Patient Name, Accession No, Date&Time, Gender/Age,
  Description, Status, Ref Doctor, Modality, Assigned Doctor, Images.
- **Search fields:** Patient ID, Patient Name, Report Content, From/To date,
  Referring Doctor (search), Tags (search), Assigned Doctor (search),
  Procedure Name / Study Description.
- **Modality filter checkboxes:** CT, MR, XRAY, ECG, XA, NM, PT, MG, US, OPG, ES, "More",
  plus "Select all". (Note: ECG is not a DICOM image modality — the system tracks it anyway.)
- **Report status tabs:** Ready, Draft, Preliminary, Final.
- **Quick date ranges:** Today, Yesterday, 14 Days, 30 Days.
- **"My Assignment"** toggle (filter to studies assigned to the logged-in user).
- **Per-row actions:** view (eye), open viewer (monitor), assign (person), edit (pencil),
  report/attach (diamond), overflow (⋮), warning (⚠).
- **Patient ID scheme:** `GG00######` (e.g. GG00247655). One row showed a raw Study UID
  as the ID (`2026.11.13-...-STD-1.3.12.2.1107.5.99.3`) — i.e. unmatched/orphan studies appear too.
- **Image counts** per study range 1 → 6645 (so the viewer must handle multi-thousand-image series).
- **Admin left-nav tree (CONFIRMED labels):**
  - Admin > User
  - Organization > Org Type, Create Org
  - Department > Create Dept, Job Type
  - Modality > New Modality
  - Doctor > Doctor Profile
  - Utilities > Report Template, Report Cancel, Locked Reports (+ more, cut off)

## STATED (you confirmed these exist, detail still needed)

- Studies **arrive** by modality push / technician import.
- A **viewer** exists (zoom/pan/window-level/measure/priors — specific tools unconfirmed).
- **Reporting** exists with the Ready→Draft→Preliminary→Final lifecycle.
- **Admin**: user accounts, roles, settings exist.

## PROPOSED (standard PACS — assumed, not seen; to be built as standard and documented)

- DICOM C-STORE SCP receiver + Modality Worklist (MWL) SCP.
- OHIF/Cornerstone3D viewer tools, W/L presets, MPR, layouts.
- Report templates per modality/department; signing; locking; addenda.
- Full RBAC role set; audit logging; notifications.
- These are in the brief's module list and are reasonable; they are **enhancements/standard
  behaviour**, not verified Pixray features, and are marked as such wherever they appear.

## Missing information — screenshots/answers still needed

1. **Viewer** screen — toolbar, measurement tools, layouts, W/L presets, MPR present?
2. **Report editor** — template picker? sections (Findings/Impression)? sign button? addendum?
3. **Admin > User** — exact fields + the real role names used by Pixray.
4. **Admin > Modality > New Modality** — fields (AE Title, host, port, MWL?).
5. **Create Org / Create Dept / Doctor Profile** — field lists.
6. **Dashboard** — does Pixray have one? (not seen in nav; brief wants one — treat as enhancement).
7. **Patient registration** — is there a patient-registration screen, or are patients created only
   from incoming DICOM? (affects RIS order-entry design).
8. **Integrations** — HL7/RIS/HIS feed? Report export to HIS? CD/print? (none seen yet).
9. **Study UID / Accession** generation rules and whether MWL is actually used on site.
10. **Report Content search** implies full-text indexing of report bodies — confirm.

## One correction to the brief

The brief lists a **Dashboard** (Module 2) and **Patient registration** (Module 3) as if
replicating Pixray. Neither is visible in the captured nav. They are good additions, but I'll
build them as **proposed enhancements**, clearly labelled, not as "existing Pixray features".
If you send a dashboard/patient screenshot, I'll reclassify them as confirmed.
