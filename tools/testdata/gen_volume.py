"""
Synthetic DICOM VOLUME generator (SYNTHETIC data only — no real PHI).

Produces a geometrically-correct multi-slice CT volume and C-STOREs it to the
PACS SCP, so OHIF/Cornerstone3D can do REAL MPR, cine, measurements and
window/level — none of it faked.

Each instance has proper volume geometry:
  - ImageOrientationPatient (axial)
  - ImagePositionPatient stepping by SliceThickness along Z
  - PixelSpacing, SliceThickness, RescaleSlope/Intercept (so HU presets work)
  - 512x512 int16 pixel data with concentric structures at distinct HU values
    (air ~ -1000, soft tissue ~ 40, bone ~ 700) that shift per slice so the
    coronal/sagittal reconstructions show real cross-sections.

Usage:
  python gen_volume.py MRN ACCESSION SLICES ROWS COLS HOST PORT [DESC] [STUDYUID]

Examples:
  python gen_volume.py GG00009001 20261114900001 300 512 512 127.0.0.1 4242 "CT CHEST VOLUME"
"""
import sys, datetime, math, struct

import numpy as np
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import generate_uid, ExplicitVRLittleEndian, CTImageStorage
from pynetdicom import AE
from pynetdicom.sop_class import CTImageStorage as CTStore

MRN     = sys.argv[1] if len(sys.argv) > 1 else "GG00009001"
ACC     = sys.argv[2] if len(sys.argv) > 2 else "20261114900001"
SLICES  = int(sys.argv[3]) if len(sys.argv) > 3 else 100
ROWS    = int(sys.argv[4]) if len(sys.argv) > 4 else 256
COLS    = int(sys.argv[5]) if len(sys.argv) > 5 else 256
HOST    = sys.argv[6] if len(sys.argv) > 6 else "127.0.0.1"
PORT    = int(sys.argv[7]) if len(sys.argv) > 7 else 4242
DESC    = sys.argv[8] if len(sys.argv) > 8 else "CT VOLUME"
STUDYUID= sys.argv[9] if len(sys.argv) > 9 else generate_uid()

PIXEL_SPACING = 0.7      # mm in-plane
SLICE_THICK   = 1.0      # mm between slices
now = datetime.datetime.now()
series_uid = generate_uid()

# Precompute a coordinate grid once.
yy, xx = np.mgrid[0:ROWS, 0:COLS].astype(np.float32)
cx, cy = COLS / 2.0, ROWS / 2.0

def slice_pixels(z_idx):
    """int16 HU image. A moving 'bone ring' + soft-tissue body + air outside,
    so axial/coronal/sagittal all show coherent anatomy-like structure."""
    # radius grid
    r = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    body_r = min(ROWS, COLS) * 0.42
    # soft tissue inside body, air outside
    hu = np.where(r < body_r, 40.0, -1000.0)
    # bone ring whose radius oscillates along z (gives varying cross-sections)
    ring_r = body_r * (0.55 + 0.15 * math.sin(z_idx / 12.0))
    ring = np.abs(r - ring_r) < 4.0
    hu[ring & (r < body_r)] = 700.0
    # a dense nodule that moves diagonally through the volume (for measurement)
    nodule_x = cx + (z_idx - SLICES / 2) * 0.3
    nodule_y = cy + (z_idx - SLICES / 2) * 0.2
    nod = np.sqrt((xx - nodule_x) ** 2 + (yy - nodule_y) ** 2) < 10
    hu[nod & (r < body_r)] = 300.0
    return hu.astype(np.int16)

def make_instance(inst_num, z_idx):
    ds = Dataset()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.MediaStorageSOPClassUID = CTImageStorage
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.ImplementationClassUID = generate_uid()

    ds.SOPClassUID = CTImageStorage
    ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
    # Patient (synthetic)
    ds.PatientName = "VOLUME^Synthetic"
    ds.PatientID = MRN
    ds.PatientBirthDate = "19800101"
    ds.PatientSex = "O"
    # Study
    ds.StudyInstanceUID = STUDYUID
    ds.StudyDate = now.strftime("%Y%m%d")
    ds.StudyTime = now.strftime("%H%M%S")
    ds.AccessionNumber = ACC
    ds.StudyDescription = DESC
    ds.ReferringPhysicianName = "REF^DOCTOR"
    ds.Modality = "CT"
    # Series
    ds.SeriesInstanceUID = series_uid
    ds.SeriesNumber = 1
    ds.SeriesDescription = DESC
    ds.InstanceNumber = inst_num
    ds.FrameOfReferenceUID = STUDYUID + ".1"
    # --- volume geometry (makes MPR real) ---
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]           # axial
    z = z_idx * SLICE_THICK
    ds.ImagePositionPatient = [-(COLS * PIXEL_SPACING) / 2,
                               -(ROWS * PIXEL_SPACING) / 2,
                               z]
    ds.SliceLocation = z
    ds.PixelSpacing = [PIXEL_SPACING, PIXEL_SPACING]
    ds.SliceThickness = SLICE_THICK
    ds.SpacingBetweenSlices = SLICE_THICK
    # --- pixel module + HU calibration (makes W/L presets real) ---
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.Rows = ROWS
    ds.Columns = COLS
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 1           # signed (HU)
    ds.RescaleIntercept = 0
    ds.RescaleSlope = 1
    ds.RescaleType = "HU"
    ds.WindowCenter = 40
    ds.WindowWidth = 400
    ds.PixelData = slice_pixels(z_idx).tobytes()
    ds.is_little_endian = True
    ds.is_implicit_VR = False
    return ds

ae = AE(ae_title="TESTSCU")
ae.add_requested_context(CTStore, ExplicitVRLittleEndian)
# allow many instances over one association
assoc = ae.associate(HOST, PORT, ae_title="GGHPACS")
if not assoc.is_established:
    print("ASSOCIATION FAILED")
    sys.exit(2)

print(f"Sending {SLICES} slices ({ROWS}x{COLS}) study={STUDYUID} acc={ACC} desc='{DESC}'")
ok = fail = 0
t0 = datetime.datetime.now()
for n in range(1, SLICES + 1):
    ds = make_instance(n, n)
    st = assoc.send_c_store(ds)
    if st and st.Status == 0x0000:
        ok += 1
    else:
        fail += 1
    if n % 50 == 0:
        print(f"  ...{n}/{SLICES}")
assoc.release()
dt = (datetime.datetime.now() - t0).total_seconds()
print(f"DONE ok={ok} fail={fail} in {dt:.1f}s")
print(f"STUDY_INSTANCE_UID={STUDYUID}")
sys.exit(0 if fail == 0 else 1)
