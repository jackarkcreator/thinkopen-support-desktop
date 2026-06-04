; ThinkOpen Support — NSIS installer customizations.
; electron-builder auto-includes build/installer.nsh (default nsis.include).

; (1) DPI awareness — render CRISPLY on HiDPI / Retina (e.g. Parallels). Without
; this NSIS declares itself non-DPI-aware and Windows bitmap-upscales the whole
; installer window → soft / pixelated. customHeader is injected before any
; Section, where ManifestDPIAware must appear.
!macro customHeader
  ManifestDPIAware true
!macroend

; (2) Brand the title bar ThinkOpen navy (#0A2540) with white text on Windows 11
; (DWM per-window caption color), instead of the default light/cream caption.
; #0A2540 → COLORREF 0x00BBGGRR = 0x0040250A. Attributes: 34=BORDER_COLOR,
; 35=CAPTION_COLOR, 36=TEXT_COLOR. These require Win11 (build 22000+); on older
; Windows DwmSetWindowAttribute returns an error we ignore, so it degrades
; gracefully. customInstall is the earliest electron-builder hook that runs while
; the installer window ($HWNDPARENT) is on screen.
!macro customInstall
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 34, *i 0x0040250A, i 4)'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 35, *i 0x0040250A, i 4)'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 36, *i 0x00FFFFFF, i 4)'
!macroend
