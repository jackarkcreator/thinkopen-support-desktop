; ThinkOpen Support — NSIS installer customizations.
; electron-builder auto-includes build/installer.nsh (default nsis.include).

; DPI awareness — render CRISPLY on HiDPI / Retina (e.g. Parallels). Without this
; NSIS declares itself non-DPI-aware and Windows bitmap-upscales the whole
; installer window → soft / pixelated. customHeader is injected before any
; Section, where ManifestDPIAware must appear.
;
; NOTE: navy title-bar coloring was attempted and abandoned — the only oneClick
; hook with the right timing (customCheckAppRunning) must re-insert the default
; running-app check, which fails to COMPILE the uninstaller; guarding it does not
; help due to NSIS's separate uninstaller compilation pass. Crisp DPI is kept; the
; title bar stays the OS default. (See project memory for the full diagnosis.)
!macro customHeader
  ManifestDPIAware true
!macroend
