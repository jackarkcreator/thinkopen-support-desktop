; ThinkOpen Support — NSIS installer customizations.
; electron-builder auto-includes build/installer.nsh (default nsis.include).

; (1) DPI awareness — render CRISPLY on HiDPI / Retina (e.g. Parallels). Without
; this NSIS declares itself non-DPI-aware and Windows bitmap-upscales the whole
; installer window → soft / pixelated. customHeader is injected before any
; Section, where ManifestDPIAware must appear.
!macro customHeader
  ManifestDPIAware true
!macroend

; Paint the installer title bar ThinkOpen navy (#0A2540 → COLORREF 0x00BBGGRR =
; 0x0040250A) with white text, via Windows 11 DWM. Attrs 34=BORDER, 35=CAPTION,
; 36=TEXT. Requires Win11 (build 22000+); on older Windows DwmSetWindowAttribute
; returns an ignored error, so it degrades gracefully.
!macro paintTitleBarNavy
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 34, *i 0x0040250A, i 4)'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 35, *i 0x0040250A, i 4)'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 36, *i 0x00FFFFFF, i 4)'
!macroend

; (2) Recolor BOTH the title bar and the progress bar EARLY. customCheckAppRunning
; runs at installSection.nsh L33 — AFTER the installer window + progress UI are
; shown (SpiderBanner, L20) but BEFORE the long file copy (L66). That's the moment
; the chrome must be recolored so it's navy DURING the visible install. (The
; default customInstall hook runs at L81, AFTER the copy — too late to be seen;
; that was why v1.0.5 stayed cream.) Because this hook REPLACES the built-in
; running-app check, we re-insert the default _CHECK_APP_RUNNING ourselves.
!macro customCheckAppRunning
  !insertmacro paintTitleBarNavy

  ; Progress bar navy: the bar (class msctls_progress32) lives inside an inner
  ; #32770 dialog of $HWNDPARENT. Walk those dialogs; for each progress bar, strip
  ; its visual theme (a themed bar ignores a custom color) then PBM_SETBARCOLOR
  ; (0x409) to navy. $8/$9 are scratch (not used by _CHECK_APP_RUNNING below).
  StrCpy $9 0
  pbNextDlg:
    FindWindow $9 "#32770" "" $HWNDPARENT $9
    StrCmp $9 0 pbDone
    FindWindow $8 "msctls_progress32" "" $9
    StrCmp $8 0 pbNextDlg
    System::Call 'uxtheme::SetWindowTheme(p $8, w "", w "")'
    SendMessage $8 0x409 0 0x0040250A
    Goto pbNextDlg
  pbDone:

  !insertmacro _CHECK_APP_RUNNING
!macroend

; Fallback: also paint the title bar at the late hook (harmless if already navy).
!macro customInstall
  !insertmacro paintTitleBarNavy
!macroend
