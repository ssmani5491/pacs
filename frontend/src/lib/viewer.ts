// Opens the OHIF viewer for a given study.
//
// Flow (Phase 6):
//  1. POST /api/viewer/session  -> backend sets an HttpOnly cookie carrying the
//     RIS access token. OHIF's DICOMweb requests (same origin) then ride that
//     cookie automatically, including WADO-RS pixel-data frames.
//  2. Navigate to /viewer/viewer?StudyInstanceUIDs=<uid>.
//
// No Orthanc credentials and no bearer token are ever exposed to the viewer JS;
// the backend proxy enforces organization isolation + audit.
import { api } from './api';

export async function openStudyInViewer(studyInstanceUid: string, hangingProtocolId?: string): Promise<void> {
  if (!studyInstanceUid) throw new Error('Missing StudyInstanceUID');
  // Establish the viewer session cookie (authorized by study.view permission).
  await api.post('/viewer/session');
  let url = `/viewer/viewer?StudyInstanceUIDs=${encodeURIComponent(studyInstanceUid)}`;
  // OHIF's own hanging-protocol URL param; 'mpr' is the standard protocol id
  // ships with the default (longitudinal) mode in the pinned v3.13.14 build.
  if (hangingProtocolId) url += `&hangingProtocolId=${encodeURIComponent(hangingProtocolId)}`;
  // Open in a new tab so the RIS worklist stays put ("return to worklist").
  window.open(url, '_blank', 'noopener');
}
