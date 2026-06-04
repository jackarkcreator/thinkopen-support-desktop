; ThinkOpen Support — NSIS installer customizations.
; electron-builder auto-includes build/installer.nsh (default nsis.include).
;
; Make the installer DPI-aware so it renders CRISPLY on HiDPI / Retina displays
; (e.g. Parallels). Without this, NSIS declares itself non-DPI-aware, so Windows
; bitmap-upscales the entire installer window → soft / pixelated. The customHeader
; hook is injected near the top of electron-builder's generated NSIS script
; (before any Section), which is exactly where ManifestDPIAware must appear.
!macro customHeader
  ManifestDPIAware true
!macroend
