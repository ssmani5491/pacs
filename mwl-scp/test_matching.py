"""Unit tests for MWL SCP matching logic (no DB/network needed)."""
import importlib.util, os, sys

# Load mwl_scp without running its server (main is guarded by __main__).
spec = importlib.util.spec_from_file_location("mwl_scp", os.path.join(os.path.dirname(__file__), "mwl_scp.py"))
mwl = importlib.util.module_from_spec(spec)
# psycopg import is fine; connecting is deferred. Load the module.
spec.loader.exec_module(mwl)

from pydicom.dataset import Dataset


def test_like_from_dicom_wildcards():
    assert mwl.like_from_dicom("MWL*") == "MWL%"
    assert mwl.like_from_dicom("A?B") == "A_B"
    # literal SQL wildcards are escaped
    assert mwl.like_from_dicom("50%") == r"50\%"
    assert mwl.like_from_dicom("a_b") == r"a\_b"


def test_build_where_excludes_completed_cancelled():
    ds = Dataset()
    where, params, filters = mwl.build_where(ds)
    assert "o.status NOT IN" in where
    assert "CANCELLED" in params and "COMPLETED" in params
    assert filters == {}


def test_build_where_patient_id_and_accession():
    ds = Dataset()
    ds.PatientID = "GG00001003"
    ds.AccessionNumber = "20261113005002"
    where, params, filters = mwl.build_where(ds)
    assert "p.mrn ILIKE %s" in where
    assert '"accessionNumber" ILIKE %s' in where
    assert "GG00001003" in params
    assert filters["PatientID"] == "GG00001003"
    assert filters["AccessionNumber"] == "20261113005002"


def test_build_where_modality_and_date_range():
    ds = Dataset()
    sps = Dataset()
    sps.Modality = "CT"
    sps.ScheduledProcedureStepStartDate = "20261101-20261130"
    ds.ScheduledProcedureStepSequence = [sps]
    where, params, filters = mwl.build_where(ds)
    assert 'o."modalityType" = %s' in where
    assert "CT" in params
    assert filters["Modality"] == "CT"
    assert filters["ScheduledDate"] == "20261101-20261130"
    # both range bounds present
    assert sum(1 for p in params if hasattr(p, "year")) == 2


def test_wildcard_name_builds_ilike():
    ds = Dataset()
    ds.PatientName = "MWL*"
    where, params, filters = mwl.build_where(ds)
    assert "p.name ILIKE %s" in where
    assert "MWL%" in params


if __name__ == "__main__":
    import traceback
    passed = failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); print(f"  [PASS] {name}"); passed += 1
            except Exception:
                print(f"  [FAIL] {name}"); traceback.print_exc(); failed += 1
    print(f"Summary: PASS={passed} FAIL={failed}")
    sys.exit(1 if failed else 0)
