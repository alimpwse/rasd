# RASD 0.15.0 verification

Verified on 22/11/2026 using Node and Chromium. All 118 unit tests and all 35 browser scripts passed, including the appearance test rerun in lossless mode for its exact-pixel assertions. The GitHub `/rasd/` overlay also passed multi-photo, quick phrase and mixed video tests, including offline reload. The overlay was compared byte for byte with the Sites app assets.

A textured synthetic 4032 × 3024 fixture shrank from 41,728,015 bytes in PNG to 6,921,382 bytes in JPEG at identical pixel dimensions. The 8 MiB target is best effort and file size depends on image content and the browser encoder. The original file is preserved byte for byte. Saving a multi-photo note was tested with zero full-size encodes. Existing PDF and backup tests passed.

The archive targets the existing GitHub repository at 0.14.0. Its Pages workflow remains in place. Real iPhone Safari memory limits, image sizes and WhatsApp delivery require a device check.
