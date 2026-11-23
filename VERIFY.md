# RASD 0.16.0 verification

The archive updates `alimpwse/rasd` from 0.15.0 to 0.16.0. The resulting app assets and tests match the source published to ChatGPT Sites. The existing GitHub Pages workflow publishes `dist` on a push to `main`.

The release passed 122 unit tests and 36 Chromium browser scenarios after rerunning the quality test with a fresh synthetic GPS timestamp. The assembled GitHub Pages overlay passed the location and camera scenario and the video workflow at `/rasd/`, including offline reload. Tested behavior includes GPS refinement, approximate pins excluded from share links, manual correction, preserving manual address fields and native camera picker fallback from a held shutter.

Test runs simulate media and location. Verify Safari permission retention, native picker behavior and real GPS accuracy on the iPhone. The package contains code, tests and documentation.
