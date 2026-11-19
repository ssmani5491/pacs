"""
DICOM Modality Worklist SCP — real C-FIND backed by the live RIS PostgreSQL.

On each MWL C-FIND, this service queries scheduled_orders (joined to patients)
directly, applies DICOM matching semantics (single value, wildcard '*', universal,
date range), builds a correct MWL dataset per order, and streams results. Every
query is logged to mwl_query_logs. No static .wl files, no simulated responses.
"""
import os
import re
import json
import logging
from datetime import datetime

import psycopg
from pynetdicom import AE, evt, debug_logger
from pynetdicom.sop_class import ModalityWorklistInformationFind
from pydicom.dataset import Dataset

logging.basicConfig(level=logging.INFO, format="%(asctime)s MWL %(levelname)s %(message)s")
log = logging.getLogger("mwl")

AE_TITLE = os.environ.get("MWL_AET", "GGHMWL")
PORT = int(os.environ.get("MWL_PORT", "4243"))
PGHOST = os.environ.get("POSTGRES_HOST", "postgres")
PGPORT = os.environ.get("POSTGRES_PORT", "5432")
PGUSER = os.environ.get("POSTGRES_USER", "pacs")
PGPASS = os.environ.get("POSTGRES_PASSWORD", "")
PGDB = os.environ.get("RIS_DB_NAME", "ris")
INSTITUTION = os.environ.get("INSTITUTION_NAME", "GG Hospital")

DSN = f"host={PGHOST} port={PGPORT} user={PGUSER} password={PGPASS} dbname={PGDB}"

# Orders in these states are excluded from the scheduled worklist.
EXCLUDED_STATUSES = ("CANCELLED", "COMPLETED")


def db():
    return psycopg.connect(DSN, autocommit=True)


def log_query(calling, called, host, status, count, filters, message=None):
    try:
        with db() as conn:
            conn.execute(
                'INSERT INTO mwl_query_logs (id, "callingAet", "calledAet", "remoteHost", status, "matchCount", filters, message, "createdAt") '
                "VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, now())",
                (calling, called, host, status, count, json.dumps(filters), message),
            )
    except Exception as e:  # never let logging break the SCP
        log.warning("Failed to write mwl_query_log: %s", e)


def like_from_dicom(value: str) -> str:
    """Convert DICOM wildcard matching (* and ?) to SQL ILIKE pattern."""
    # escape SQL wildcards, then map DICOM wildcards
    v = value.replace("%", r"\%").replace("_", r"\_")
    v = v.replace("*", "%").replace("?", "_")
    return v


def build_where(ds: Dataset):
    """Translate an incoming MWL query dataset into a SQL WHERE + params + filters dict."""
    clauses = [f"o.status NOT IN ({','.join(['%s'] * len(EXCLUDED_STATUSES))})"]
    params = list(EXCLUDED_STATUSES)
    filters = {}

    pid = getattr(ds, "PatientID", "") or ""
    if pid and pid != "*":
        clauses.append("p.mrn ILIKE %s")
        params.append(like_from_dicom(pid))
        filters["PatientID"] = pid

    pname = str(getattr(ds, "PatientName", "") or "")
    if pname and pname.strip("*^ "):
        clauses.append("p.name ILIKE %s")
        params.append(like_from_dicom(pname.replace("^", " ").strip()))
        filters["PatientName"] = pname

    acc = getattr(ds, "AccessionNumber", "") or ""
    if acc and acc != "*":
        clauses.append("o.\"accessionNumber\" ILIKE %s")
        params.append(like_from_dicom(acc))
        filters["AccessionNumber"] = acc

    # Scheduled Procedure Step Sequence carries Modality + scheduled date + station AET
    modality = None
    sched_date = None
    station_aet = None
    if "ScheduledProcedureStepSequence" in ds and len(ds.ScheduledProcedureStepSequence) > 0:
        sps = ds.ScheduledProcedureStepSequence[0]
        modality = getattr(sps, "Modality", "") or None
        sched_date = getattr(sps, "ScheduledProcedureStepStartDate", "") or None
        station_aet = getattr(sps, "ScheduledStationAETitle", "") or None

    if modality and modality != "*":
        clauses.append("o.\"modalityType\" = %s")
        params.append(modality)
        filters["Modality"] = modality

    if sched_date:
        # DICOM date range: "YYYYMMDD", "YYYYMMDD-YYYYMMDD", "-YYYYMMDD", "YYYYMMDD-"
        filters["ScheduledDate"] = sched_date
        if "-" in sched_date:
            lo, hi = sched_date.split("-", 1)
            if lo:
                clauses.append("o.\"scheduledAt\" >= %s")
                params.append(datetime.strptime(lo, "%Y%m%d"))
            if hi:
                hi_dt = datetime.strptime(hi, "%Y%m%d").replace(hour=23, minute=59, second=59)
                clauses.append("o.\"scheduledAt\" <= %s")
                params.append(hi_dt)
        else:
            d = datetime.strptime(sched_date, "%Y%m%d")
            clauses.append("o.\"scheduledAt\" >= %s AND o.\"scheduledAt\" < %s")
            params.append(d)
            params.append(d.replace(hour=23, minute=59, second=59))

    if station_aet and station_aet != "*":
        filters["ScheduledStationAETitle"] = station_aet
        # we don't bind station AET to a column yet; recorded in filters only

    where = " AND ".join(clauses)
    return where, params, filters


def da(dt):   # DICOM DA
    return dt.strftime("%Y%m%d") if dt else ""


def tm(dt):   # DICOM TM
    return dt.strftime("%H%M%S") if dt else ""


def row_to_mwl(row) -> Dataset:
    """Build a correct MWL response dataset from one order row."""
    (acc, modality, proc_desc, study_desc, clinical, priority, sched_at,
     mrn, pname, dob, sex, ref_name) = row

    ds = Dataset()
    # Patient (top-level)
    ds.PatientID = mrn or ""
    ds.PatientName = (pname or "").replace(" ", "^")
    ds.PatientBirthDate = da(dob)
    ds.PatientSex = sex or ""
    # Study / request level
    ds.AccessionNumber = acc or ""
    ds.ReferringPhysicianName = (ref_name or "").replace(" ", "^")
    ds.StudyInstanceUID = ""  # assigned by modality
    ds.RequestedProcedureID = acc or ""
    ds.RequestedProcedureDescription = proc_desc or study_desc or ""
    ds.InstitutionName = INSTITUTION
    # Scheduled Procedure Step Sequence
    sps = Dataset()
    sps.Modality = modality or ""
    sps.ScheduledProcedureStepStartDate = da(sched_at)
    sps.ScheduledProcedureStepStartTime = tm(sched_at)
    sps.ScheduledProcedureStepDescription = proc_desc or study_desc or ""
    sps.ScheduledProcedureStepID = acc or ""
    sps.ScheduledStationAETitle = ""  # any station
    sps.ScheduledPerformingPhysicianName = ""
    ds.ScheduledProcedureStepSequence = [sps]
    return ds


SELECT_COLS = (
    'o."accessionNumber", o."modalityType", o."procedureDesc", o."studyDescription", '
    'o."clinicalHistory", o.priority, o."scheduledAt", '
    'p.mrn, p.name, p.dob, p.gender, '
    "(SELECT d.name FROM doctors d WHERE d.id = o.\"referringDoctorId\")"
)


def handle_find(event):
    assoc = event.assoc
    requestor = assoc.requestor
    calling = requestor.ae_title.strip() if requestor.ae_title else ""
    called = requestor.primitive.calling_ae_title if hasattr(requestor, "primitive") else AE_TITLE
    host = requestor.address

    ds = event.identifier
    try:
        where, params, filters = build_where(ds)
        sql = (
            f"SELECT {SELECT_COLS} FROM scheduled_orders o "
            "JOIN patients p ON p.id = o.\"patientId\" "
            f"WHERE {where} ORDER BY o.\"scheduledAt\" ASC LIMIT 500"
        )
        rows = []
        with db() as conn:
            cur = conn.execute(sql, params)
            rows = cur.fetchall()

        log.info("C-FIND from %s@%s filters=%s -> %d matches", calling, host, filters, len(rows))
        for row in rows:
            yield 0xFF00, row_to_mwl(row)   # Pending, one dataset each

        status = "SUCCESS" if rows else "NO_MATCH"
        log_query(calling, AE_TITLE, host, status, len(rows), filters)
        yield 0x0000, None  # Success, end

    except Exception as e:
        log.exception("MWL C-FIND failed")
        log_query(calling, AE_TITLE, host, "FAILED", 0, {}, str(e)[:300])
        yield 0xA700, None  # Out of resources / failure


def handle_requested(event):
    """Reject associations whose called AE title is not ours."""
    primitive = event.assoc.requestor.primitive
    called = (primitive.called_ae_title or "").strip() if primitive else ""
    calling = (primitive.calling_ae_title or "").strip() if primitive else ""
    host = event.assoc.requestor.address
    if called and called != AE_TITLE:
        log.warning("Rejecting association: called AE '%s' != '%s' (from %s@%s)", called, AE_TITLE, calling, host)
        log_query(calling, called, host, "REJECTED", 0, {"reason": "called AE mismatch"})
        # 0x01=rejected-permanent, 0x01=DICOM UL service-user, 0x07=called AE not recognised
        event.assoc.acse.send_reject(0x01, 0x01, 0x07)
        event.assoc.kill()


def main():
    handlers = [
        (evt.EVT_REQUESTED, handle_requested),
        (evt.EVT_C_FIND, handle_find),
    ]
    ae = AE(ae_title=AE_TITLE)
    ae.add_supported_context(ModalityWorklistInformationFind)
    log.info("MWL SCP starting: AET=%s port=%d db=%s@%s", AE_TITLE, PORT, PGDB, PGHOST)
    ae.start_server(("0.0.0.0", PORT), evt_handlers=handlers, block=True)


if __name__ == "__main__":
    main()
