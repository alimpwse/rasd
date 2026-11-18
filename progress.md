# Video release progress — plan: docs/superpowers/plans/2026-11-18-video.md

Baseline: 9aa6e55 (portable 0.13.0 source). User chose unmodified video plus shared description/map. Owner implementation choices: 60-second/50MiB clip cap and PDF still previews, as communicated. Isolated new export, no old-host publication.

Pre-flight: data contracts and recorder/decode modules have disjoint file ownership and agreed API signatures. Owner app/report integration consumes those APIs; no agent may edit app/report/package/docs. Existing photos array name deliberately retained for minimal legacy compatibility.

Task 1: implemented; model/backup/DB5 tests RED→GREEN, legacy v3/v4 writer browser checks passed.
Task 2: implemented; 18 focused capture/decoder tests and real synthetic browser recording passed.
Task 3: complete; mixed/video-only save, share bytes, backups, deletion and PDF previews verified. Held shutter temporarily disabled by the general control loop reproduced (9 transitions) and fixed. Full regression: 118 Node tests and all 35 Chromium scripts passed. The video scenario also passed under /rasd/, including offline reload.
Task 4: complete; documentation, workflow validation and portable ZIP checks passed. Archive has 99 files, including the AI handoff, upload guide, tests and font license. Previous 0.13.0 ZIP remains unchanged. No deployment performed. Implementation review closed as below.

Review rulings:
- Important pointer-cancel issue accepted. Added RED tests for active-pointer cancellation and unrelated-pointer cancellation; fixed discard and pointer-ID matching. GREEN in full suite.
- Metadata finding upgraded from Minor to Important because incorrect restored duration/dimensions would persist into reports. RED browser backup with plausible but incorrect metadata reproduced it; restoration now uses actual decoded metadata. GREEN in root and project-path scenarios.
- Real iPhone/Safari/WhatsApp behavior remains device acceptance; no claim of physical verification or deployment. ZIP checks are performed by the owner during packaging.
- An initial final browser run exposed a test timing issue: the offline library assertion ran before asynchronous IndexedDB rendering. It now waits for the expected cards before asserting; the full suite and project-path rerun passed.
