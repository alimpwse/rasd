# RASD 0.14.0 verification

Verified locally on 18/11/2026. This is a portable GitHub Pages release; no GitHub repository or hosted deployment was created. The previous 0.13.0 export and existing published application were not changed.

## Completed checks

- **118/118 Node tests passed** using Node.js 24.22.1, including video validation, exact backup byte round trips, gesture cancellation, permission races, recording limits and decoder cleanup.
- **35/35 Chromium browser scripts passed**, including all existing photo/draft/settings/report/backup regressions and the new video engine/integration scenarios. Inputs and browser profiles were synthetic and isolated.
- Video integration also passed from **`/rasd/`**, matching a GitHub Pages project-path layout: mixed and video-only notes, playback/reload, original-byte sharing, photo markup retention, actual metadata on restore, removing videos, deleting notes, PDF still previews, held-shutter recording, Save & Next and offline reload.
- Recorded synthetic camera/audio streams through MediaRecorder and decoded real output. Verified WebM duration probing, format rejection and object-URL cleanup. Share tests inspect the user-activated Web Share payload, including byte equality; they do not send messages to WhatsApp.
- Old database v3/v4 writers cannot overwrite the v5 media library. Photo-only backup output remains v3; video-containing backups use v4. Existing photos and Arabic presets/defaults pass the regression suite.
- Inspected the mobile video editor visually. Parsed all 76 JavaScript modules, checked the workflow YAML and `dist` artifact target, verified relative manifest/service-worker paths and both new offline modules. `git diff --check` passed.
- ZIP entries are checked against the source files, ZIP integrity is tested, and package-local Markdown links resolve. The archive excludes Git history, test output, dependencies, host configuration and user data. It includes the GitHub Actions workflow and the bundled font license.

## Device acceptance still required

Open the deployed HTTPS URL in Safari and its Home Screen installation on the intended iPhone. Test normal photo capture, first microphone permission, held-shutter start/release, native video fallback, imported phone video, app interruption, save/reopen, offline use and actual WhatsApp delivery. Automated Chromium tests do not establish iOS codec/camera behavior, Apple Camera quality, storage eviction or WhatsApp caption handling/recompression.

Videos remain unmodified; date/place text is not burned into them. Limits are 60 seconds / 50 MiB per clip and 10 attachments / 100 MiB per note. The existing 64 MiB backup-file cap remains: base64 overhead can make a large video library, or even one near-limit clip, exceed that cap. Keep original files externally when a backup cannot fit. PDF contains still previews only.

## Reproduce

Run `npm test`, serve `dist` with the local server in README, then run `npm run test:browser` with Playwright/Chromium available. The browser scripts accept `PLAYWRIGHT_MODULE` for an existing Playwright installation. Use isolated test profiles; never run them against personal data. No runtime dependency or build step is required for hosting.
