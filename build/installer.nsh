; ThinkOpen Support — NSIS installer customizations.
; electron-builder auto-includes build/installer.nsh (default nsis.include).

; DPI awareness — render CRISPLY on HiDPI / Retina (e.g. Parallels). Without this
; NSIS declares itself non-DPI-aware and Windows bitmap-upscales the whole
; installer window → soft / pixelated. customHeader is injected before any
; Section, where ManifestDPIAware must appear.
!macro customHeader
  ManifestDPIAware true
!macroend
