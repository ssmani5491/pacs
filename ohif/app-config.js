/**
 * OHIF Viewer runtime config — Enterprise RIS+PACS replica (Phase 6).
 *
 * Mounted into the OHIF container at /usr/share/nginx/html/viewer/app-config.js.
 * Served with Cache-Control: no-store so edits take effect on reload.
 *
 * Auth model: OHIF makes DICOMweb calls to our OWN backend proxy at
 * /api/dicom-web. The browser authenticates with the RIS session carried in an
 * HttpOnly cookie (set by POST /api/viewer/session before the viewer opens), so
 * NO Orthanc credentials and NO bearer token live in this file or in JS. The
 * proxy enforces organization isolation and audit-logs study access.
 */
window.config = {
  name: 'config/pacs-replica.js',
  // Served under http://<host>/viewer/
  routerBasename: '/viewer',

  // Single local deployment; no remote auth provider. (Do NOT set oidc:[] —
  // OHIF v3.13 still mounts the OIDC route and reads oidc[0].authority, which
  // crashes on an empty array. Omitting the key disables OIDC cleanly.)
  showStudyList: true,
  // Local, offline — no external error reporting.
  extensions: [],
  modes: [],
  customizationService: {},

  // ---- Performance (Module 9: large CT/MRI studies 5,000-6,600 images) ------
  // 3 workers is the upstream-recommended safe default (Windows stability).
  maxNumberOfWebWorkers: 3,
  // Keep progressive/lazy loading on so large series stream instead of
  // downloading whole studies up front.
  maxNumRequests: {
    interaction: 100,
    thumbnail: 75,
    prefetch: 25,
  },
  // Show patient name / MRN etc. in the viewer study browser.
  studyListFunctionsEnabled: true,
  // Default WindowLevel preset behaviour comes from Cornerstone3D (CT presets
  // available in the toolbar); custom presets also configurable per-mode.

  defaultDataSourceName: 'dicomweb',

  dataSources: [
    {
      friendlyName: 'PACS Replica (Orthanc via authenticated proxy)',
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        name: 'orthanc-proxy',
        // All three roots go through our backend proxy (same origin => the
        // HttpOnly session cookie is sent automatically, including on WADO-RS
        // frame requests that OHIF's image loader would not header-authenticate).
        wadoUriRoot: '/api/dicom-web',
        qidoRoot: '/api/dicom-web',
        wadoRoot: '/api/dicom-web',

        qidoSupportsIncludeField: true,
        supportsReject: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        // Orthanc 1.13 DICOMweb compatibility.
        omitQuotationForMultipartRequest: true,
        // Deliver bulkdata/video single-part; pixel frames multipart.
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
        // Same-origin credentialed requests so the session cookie is attached.
        requestOptions: {
          withCredentials: true,
        },
      },
    },
  ],

  // After signing a report (Phase 7) we will deep-link back to the worklist;
  // for now provide a simple return path used by the "Back to Worklist" control.
  // (Consumed by a small customization injected per deployment if needed.)
};
