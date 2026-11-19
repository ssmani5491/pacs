# Recon map: Pixray PACS — RISPACS Enterprise Edition (web)

Vendor: Teciatric Informatics (outsourced, vendor-licensed to GG Hospital)
Scope: Full working PACS/RIS — worklist, DICOM store/arrival, web viewer, reporting, admin
For: GG Hospital (internal replacement of licensed vendor system)
Date: 2026-11-13
Rebuild stance: clean-room. Document behaviour + workflow only. No vendor code,
branding (Pixray/Teciatric), logos, or pixel-copied screens. Rebrand before any launch.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Worklist screen (live, own admin account) | 172.16.7.82:2000/worklist | primary evidence, screenshot S01 |

## Core loop

A study is pushed/imported into the PACS → appears in the Worklist with a status →
radiologist opens it in the viewer → reads/measures → writes a report that moves through
Ready → Draft → Preliminary → Final → report is retrievable and (likely) sent to RIS/HIS.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Worklist | /worklist | list + search all studies to read | search panel, modality filter checkboxes, status tabs, results table, pagination, per-row action icons | filled (48117 rows), status badges Ready/Final |
| S02 | Viewer | row action (monitor icon) | view DICOM images, zoom/pan/W-L/measure/priors | TBD | TBD |
| S03 | Report editor | row action (pencil icon?) | write/sign report | TBD | TBD |
| S04 | Admin: Users | Admin > User | user accounts + roles | TBD | TBD |
| S05 | Admin: Organization | Admin > Organization (Org Type, Create Org) | multi-org/tenant setup | TBD | TBD |
| S06 | Admin: Department | Admin > Department (Create Dept, Job Type) | departments | TBD | TBD |
| S07 | Admin: Modality | Admin > Modality (New Modality) | register modalities / AE titles | TBD | TBD |
| S08 | Admin: Doctor | Admin > Doctor (Doctor Profile) | referring/assigned doctors | TBD | TBD |
| S09 | Admin: Utilities | Admin > Utilities (Report Template, Report Cancel, Locked Reports) | templates + report admin | TBD | TBD |

## S01 Worklist — detail (from screenshot)

Top bar: logo, "GG Hospital / RISPACS Enterprise Edition", "Welcome admin!", account menu.
Left nav: Worklist; Admin > User; Organization (Org Type, Create Org); Department
(Create Dept, Job Type); Modality (New Modality); Doctor (Doctor Profile); Utilities
(Report Template, Report Cancel, Locked Reports, …more).

Search panel (collapsible "Hide Search"):
- Patient ID, Patient Name, Report Content, From (date), To (date),
  Referring Doctor (searchable), Tags (searchable), Assigned Doctor (searchable),
  Procedure Name / Study Description.
- Modality filter: Select all + checkboxes CT, MR, XRAY, ECG, XA, NM, PT, MG, US, OPG, ES, More.
- Status tabs (segmented): Ready | Draft | Preliminary | Final.
- Quick date range: Today | Yesterday | 14 Days | 30 Days.
- Buttons: Search, Clear. Toggle: "My Assignment".

Results table columns:
`Action | Patient ID | Patient Name | Accession No | Date&Time | Gender/Age |
Description | Status | Ref Doctor | Modality | Assigned Doctor | Images`
- Per-row Action icons: view (eye), open-viewer (monitor), assign (person),
  edit (pencil), report/attach (diamond), + overflow (⋮) and a warning (⚠) icon.
- Status badge values seen: Ready (blue), Final (green). Report states inferred:
  Ready → Draft → Preliminary → Final.
- Pagination: Rows per page (10), "Showing 10 of 48117", page 1 of 4812.

## Flows

```
F01 Study arrives
    modality/technician push or import -> study created -> appears in S01 Worklist, status Ready
F02 Radiologist reads a study
    S01 worklist -> filter by modality/status/date -> open S02 viewer -> view/measure/compare priors
F03 Report lifecycle
    S02/S01 -> S03 report editor -> Draft -> Preliminary -> Final (sign) -> Locked
    admin: Report Cancel, Locked Reports, Report Template (Utilities)
F04 Assignment
    "Assigned Doctor" column + "My Assignment" toggle -> studies routed to a reading doctor
```

## Inferred data model

```
Organization  id, org_type, name                      evidence: Org Type, Create Org   confidence: high
Department    id, org_id, name, job_type               evidence: Create Dept, Job Type  confidence: high
Modality      id, code (CT/MR/CR/...), ae_title?        evidence: modality filters, New Modality  confidence: high
Doctor        id, name, role (referring|assigned|reading), profile  evidence: Ref/Assigned Doctor, Doctor Profile  confidence: high
Patient       id (GG00######), name, gender, age/dob    evidence: S01 columns  confidence: high
Study         id, patient_id, accession_no, study_datetime, description,
              modality, status(ready|draft|preliminary|final), ref_doctor_id,
              assigned_doctor_id, image_count, tags[]    evidence: S01 columns/filters  confidence: high
Series/Instance (DICOM)  study_id, ... images            evidence: "Images" count (1..6645)  confidence: high (DICOM standard)
Report        id, study_id, content, status, template_id, locked, cancelled
                                                         evidence: Report Content search, Utilities  confidence: medium
ReportTemplate id, name, body                            evidence: Utilities>Report Template  confidence: high
```

## What cannot be cloned (skip)

- Vendor branding "Pixray" / "Teciatric Informatics", their logos and exact styling — rebrand.
- The vendor's source code and any private API — not read, not copied.
- Existing patient data lives in the current DB; migration is a separate, consented task, not a clone.

## Size

L–XL. Core worklist + store + reporting is achievable on open-source foundations
(Orthanc or dcm4chee for the DICOM archive, OHIF for the viewer, a custom RIS layer for
worklist/reporting/admin). Hard parts: DICOM C-STORE receiver + modality worklist (MWL),
a performant web viewer for 5000+ image studies, report lifecycle + signing, multi-org/dept
roles, RIS/HIS + HL7 integration.
