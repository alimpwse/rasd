# RASD: instructions for AI coding assistants

Read this file before editing. It describes the existing product and its data contracts, not a request to build new features. Follow the user's latest explicit request; make the smallest complete change and preserve unrelated work. Update this document if those contracts intentionally change.

## Product and owner preferences

- RASD is a personal construction-site observation PWA, primarily used on iPhone in Kuwait. The owner communicates in Arabic; the application interface stays **English**, with Arabic/mixed-language note text and labels supported.
- Camera-first capture, direct on-photo arrows/circles/text editing, combined markup/details, local drafts, multiple photos per note, project presets, editable categories and category-specific quick phrases, WhatsApp sharing, selected-note PDF reports, and full backup/restore already exist.
- The scope is recording observations. Do not add assignments, accounts, responsible-person invitations, resolution status, or before/after workflows unless explicitly requested.
- Dark is the default; Light is available. Keep the existing restrained dark/gold design. Latin uses the system font; Arabic uses bundled IBM Plex Sans Arabic. Keep readable text and large touch controls.
- The user wants direct editing on the photo and few unnecessary controls. Keep Save note, Save & Next and Share accessible on mobile.

## Architecture and repository map

This is a buildless static application using HTML/CSS and native ES modules. There is no React, bundler, runtime npm dependency, server, authentication, or cloud photo database. **`dist/` is the editable source**, despite its name. Never delete it as generated output.

| Files | Responsibility |
| --- | --- |
| `dist/index.html`, `styles.css` | UI, dialogs, responsive layout, themes |
| `dist/app.js` | App orchestration, editor/library/settings, acquisition/share/restore gates |
| `camera.js` | Live preview and camera lifecycle |
| `video.js`, `video-capture.js` | Video metadata/thumbnail probing and held-shutter recording lifecycle |
| `editor.js`, `framing.js` | Canvas markup, selection/handles, optional crop, export |
| `model.js` | Validation, legacy photo adapters, note backups, share text, Maps URL |
| `storage.js`, `drafts.js` | IndexedDB, atomic saved-note/draft operations, conflict detection |
| `preferences.js`, `stamp.js`, `datetime.js`, `fonts.js` | Settings, printed information, Kuwait date/time and fonts |
| `categories.js`, `phrases.js`, `projects.js` | Local editable catalogs and defaults |
| `address.js` | Reverse-geocoding and local cache |
| `backup.js` | Full backup validation, replacement and restore journal |
| `report-ui.js`, `report.js`, `pdf.js` | Multi-note reports, rendering and PDF encoding |
| `library.js` | Search/filter/order/group logic |
| `sw.js`, `manifest.webmanifest` | Offline shell, updates and installable PWA |
| `tests/` | Node unit tests and Playwright browser scenarios |

Paths above without a prefix are in `dist/`. See `docs/TECHNICAL.md` for feature details. Historical release notes in that document describe older behavior; this file and current code describe the current defaults.

## Protect local data

- Images and descriptions stay on the device. Do not introduce upload/analytics/account flows or put backups, secrets, personal photos, or device-specific credentials into the repository.
- IndexedDB is `rasd-field-notes`, currently version **5**, with `notes`, `drafts` and `restore` stores. Older photo-only writers (v3 and v4) are blocked intentionally. Never clear or rename the database to fix an upgrade issue.
- Preserve localStorage keys and stable category/phrase IDs. Read their defining modules before changing them. UI label changes must not change identity or membership.
- Photo-only backups remain v3. Backups containing video use v4; they include original media bytes, metadata/previews, saved notes, settings, categories, phrases and projects. Video payloads in earlier backup versions are rejected. Legacy v1 note-only and v2 full backups still load. Note-only imports merge; full restores replace after confirmation.
- Restoration commits records and a pending settings journal atomically. Startup replays/verifies the journal before constructing preferences/catalogs. Other open windows are gated by a restore revision. Never bypass those gates or claim success before durable completion.
- Draft updates use optimistic version checks. Saved-note commit removes its matching draft atomically; stale windows cannot overwrite/delete a newer draft or resurrect a deleted note.
- A full backup requires drafts to be saved or deliberately discarded. Current backup limit is 64 MiB / 500 notes. Do not silently omit images, compress originals, or discard drafts to fit it.
- Different domains have different browser storage. Migration requires Back up everything / Restore backup. Browsers can evict local storage; do not promise permanent storage or cloud synchronization.

## Capture, editing, and sharing contracts

- The live preview is not the source of the full-quality saved photograph. The shutter invokes the native file-input camera from a user gesture. Preserve the exact supplied original Blob.
- An iPhone web app cannot force the native camera picker to offer 16:9 or guarantee Apple Camera HDR/ProRAW/48 MP. Users can capture 16:9 in Apple Camera and import. Never silently crop new images; optional crop remains explicit and reversible.
- Exports use full decoded-resolution PNG within the selected crop; the information strip appends height without shrinking the photo. Only thumbnails may be resized/lossy. Preserve original-download byte equality.
- A note has 1–10 ordered photo/video attachments in the legacy-named `photos` array. Photo shapes are unchanged. Video shapes have `kind: "video"`, duration/width/height, original video Blob, image thumbnail, empty annotations and original crop. Use `isVideo`/`mediaExtension` helpers; never pass video originals to PhotoEditor/loadImage. Photos retain independent markup/crop. Description, category, project, location and stamp/export settings are shared. Limits: 25 MiB and 80 MP per source image, videos up to 60 seconds / 50 MiB, 100 MiB originals per note; canvas memory may impose a lower practical limit.
- Prepare share files before the user taps Share so `navigator.share` retains user activation. Support explicit fallbacks; never silently share only one photo from a multi-photo note. WhatsApp may ignore captions or recompress photos; downloading and sending as a document is the unchanged-file fallback.
- Save & Next advances only after a successful durable save of the latest revision, including late GPS/address changes. It returns to the camera; the next native capture still needs a tap. It carries project/category only, with fresh date/GPS, blank description/address and no copied annotations.
- Round context is session-only. Camera cancellation retains it; successful acquisition consumes it; End round/reload clears it. Failed saves, conflicting drafts and pending restores keep the current editor available.
- PDF reports use saved versions: up to 20 notes / 50 attachments / 100 MiB. Videos appear as labeled still previews; the actual video file is shared separately. Full-resolution cropped photos are losslessly embedded; Arabic text is rasterized consistently, not selectable PDF text. Cancellation and stale-generation guards must stay intact.

### Video capture and playback (0.14.0)

`HoldVideoCapture` owns the shutter's pointer/click listeners. Short clicks preserve native picker user activation. A 400 ms hold clones the live preview video track and requests microphone access; release ends recording. Releasing during a permission prompt invalidates the request so it cannot start later. Recording auto-stops at 59.75 seconds for muxing margin; decode/validation still enforce an actual 60-second maximum. Native video capture and Library import are explicit fallbacks.

Keep the held shutter enabled while disabling other navigation controls; temporarily disabling it can break pointer capture. Stop on hidden/pagehide/track end. Do not stop preview tracks owned by Camera when cleaning recorder clones. Do not clear a saved video player source on pagehide: a back/forward-cache return must still play it. Pause it instead.

Pointer cancellation discards the current recording only when its pointer ID matches the held shutter; cancellation of another touch must be ignored. Backup restoration decodes videos before replacing data and uses their actual duration/dimensions, not untrusted backup metadata.

MP4 is preferred if MediaRecorder supports it, with supported WebM fallback. Imported MP4/MOV/WebM must actually decode. MediaRecorder WebM may report Infinity until the browser seeks through the timeline; `inspectVideo` measures actual duration rather than inventing it. Enforce dimensions/size/time caps, timeout cleanly and release object URLs/tracks. Preserve the supplied/recorded video Blob; do not burn stamps or recompress it. Use an unparameterized video MIME for Web Share files while keeping bytes unchanged. Actual iPhone camera quality, codec support and WhatsApp delivery require device acceptance.

## Current appearance and defaults (0.14.0)

New preferences use **Dark** and **Information strip**. Printed fields: location/date/time on; project/category/note off. Printed address: block/street on, area off. Coordinates remain stored but never print on the photo.

WhatsApp message is enabled. Message fields: note/block/street/Maps link on; project/category/date/time/area off. Printed and message fields are independent. Automatic address is on.

These defaults belong to the `Preferences` constructor. **Do not change legacy fallback normalization (`DEFAULT_STAMP`, `normalizeStamp`, `normalizeExport`) to implement new defaults**: existing records/backups rely on their earlier interpretation. Existing saved preferences and note-level stamp/export settings remain authoritative. Applying defaults to an existing note is explicit.

- All printed information aligns left, including Arabic, while each text run keeps its reading direction. Wait for fonts before canvas measurement/export.
- Dates use `DD/MM/YYYY`; time uses `h:mm AM/PM`, no KWT, in Asia/Kuwait. Visible metadata label is Date & time. Imported-photo time is when added, not a claim about EXIF capture time.
- The strip adapts to portrait/landscape. The optional on-photo layout uses a soft black gradient. UI theme must not recolor exported photographs.

Current quick phrases (punctuation included):

| Category / stable ID | Phrases |
| --- | --- |
| Safety / `safety` | عدم الالتزام بإجراءات الأمن والسلامة. — الحواجز غير مغلقة بإحكام. — الحواجز غير كافية لتأمين الموقع. |
| Site Cleanliness / `housekeeping` | إزالة الأنقاض. — تنظيف الموقع. — إزالة البايبات. |
| Site Works / `cat_site_works` | فرش طبقة ميلينق. |

Use البايبات, not الأنابيب; no يلزم in these presets. Default category is Uncategorized unless the user selected another. `cat_site_works` intentionally uses a backward-readable custom ID. An implicit Site Works label is disambiguated if an existing category uses that name. Full-backup validation reserves its extra slot so a valid old 1000-category catalog stays backup-able.

Phrase `defaultsVersion: 2` preserves intentional deletions across reload/backup. Upgrade only exact untouched legacy ID/category/text triples; retain custom edits/deletions. Old full backups without a phrase catalog use the legacy fallback before upgrade. Do not reseed every launch.

## Location and external services

GPS is fresh per note, with manual address edits preserved against delayed responses. Photon/OpenStreetMap (`https://photon.komoot.io/reverse`) is the only runtime address lookup; coordinates are sent, photographs and note text are not. Automatic address can be disabled. Coverage is approximate, not authoritative PACI data: leave missing fields blank and never invent block/street values.

Keep accuracy/distance checks, request throttling and cache behavior in `address.js`. Offline uses a matching cached address or manual fields. No background tracking. The Maps link uses `https://maps.google.com/?q=latitude,longitude`; there is no URL-shortener backend.

## GitHub Pages and offline updates

- `.github/workflows/pages.yml` publishes **only `dist`**, triggered on `main` or manually. Enable Settings → Pages → Source: GitHub Actions. No install/build or secret token is required for this workflow.
- Keep asset/import URLs relative. Project sites may live at `/repository/`, not the domain root. Manifest `id`, `start_url`, `scope`, and service-worker registration use `./`.
- Service worker shell cache is currently `rasd-shell-v16`. Cache the canonical directory URL `./`, not a redirected `/index.html`. Precache uses `redirect: 'error'`; returning a followed redirect for a navigation previously broke Safari.
- On every shipped app-asset change, increment the shell cache version and update the app version in `package.json` and visible version strings in `index.html`. Add new required offline assets to `FILES` in `sw.js`. A docs-only change does not need an app version bump.
- Keep explicit Update acceptance for normal upgrades. Do not unconditionally skip waiting, reload an unsaved editor or wipe user storage. The limited auto-recovery for historical caches v1/v2 is intentional.
- Avoid hosting separate independent RASD copies under one `username.github.io` origin: IndexedDB/localStorage keys and cache names are shared by origin, even across different paths. Use one canonical installation per origin or intentionally design a migration/namespacing strategy.
- This export is independent of the original host. No `.openai` config, Git history or hosting credentials are included. Do not restore a previous hosting identity or deploy elsewhere unless requested.

## Development and verification

Use Node.js 24 (the validated version) and Python 3 for local checks; no dependencies are needed to run the app or unit tests.

```sh
npm test
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:4173/`, not `file://`. For Windows use `py -3` if `python3` is unavailable.

Browser tests require Playwright and its Chromium binary. Install only for development if unavailable:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node -e "require('fs').mkdirSync('test-results',{recursive:true})"
npm run test:browser
```

Run the HTTP server in another terminal while browser tests execute. Tests accept `PLAYWRIGHT_MODULE` for an already installed runtime and most accept `TEST_URL`; some service-worker tests intentionally use root-scoped local fixtures. Do not run write-producing browser tests against a real user's browser profile or data. Test inputs are synthetic.

Before a meaningful logic change, reproduce the relevant failure; then run the matching tests. For storage, backup, defaults, capture, sharing or service-worker changes, run the full unit/browser suites. Check portrait/landscape, Arabic, offline launch, reload persistence and error paths as relevant. If a new default invalidates a fixture that intended to enable a feature, enable that option explicitly rather than weakening its assertion.

The 0.14.0 release passed 118 Node tests and 35 Chromium browser scripts, plus the video integration scenario under a `/rasd/` project path. The video suites cover capture races, decoding, mixed notes, original bytes, removal, restored metadata and old-writer blocking. The export verification record is in `VERIFY.md`. Automated Chromium tests do not prove real Safari camera quality, iOS termination behavior or WhatsApp delivery. Report untested behavior accurately.

When handing changes back, state what changed, what ran and any material limitation. Do not invent successful deployments or physical-device results. Keep README/this guide accurate, retain the font license, and do not add a code license on the owner's behalf.
