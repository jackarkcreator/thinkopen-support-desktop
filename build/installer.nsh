; ThinkOpen Support — NSIS installer customizations.
; electron-builder auto-includes build/installer.nsh (default nsis.include).

; (1) DPI awareness — render CRISPLY on HiDPI / Retina (e.g. Parallels). Without
; this NSIS declares itself non-DPI-aware and Windows bitmap-upscales the whole
; installer window → soft / pixelated.
!macro customHeader
  ManifestDPIAware true
!macroend

; Paint the installer title bar ThinkOpen navy (#0A2540 → COLORREF 0x00BBGGRR =
; 0x0040250A) with white text, via Windows 11 DWM. Attrs 34=BORDER, 35=CAPTION,
; 36=TEXT. Win11 (22000+) only; on older Windows DwmSetWindowAttribute returns an
; ignored error → degrades gracefully.
!macro paintTitleBarNavy
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 34, *i 0x0040250A, i 4)'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 35, *i 0x0040250A, i 4)'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 36, *i 0x00FFFFFF, i 4)'
!macroend

; (2) Apply the navy title bar at the RIGHT time. customCheckAppRunning runs at
; installSection.nsh L33 — AFTER the installer window is shown (SpiderBanner, L20)
; but BEFORE the long file copy (L66) — so the bar is navy DURING the visible
; install. (Why not the others: customHeader can't hold runtime code; customInstall
; runs at L81 AFTER the copy → only visible as the window closes, which is why
; v1.0.5 stayed cream; customInstallMode is excluded for oneClick; .onInit hooks
; run before $HWNDPARENT exists.) This hook REPLACES the built-in running-app
; check, so we re-insert the default _CHECK_APP_RUNNING. The recolor is guarded to
; the installer so the uninstaller's path stays identical to the default.
!macro customCheckAppRunning
  ; Installer only. Re-inserting _CHECK_APP_RUNNING from this overriding hook
  ; fails to COMPILE in the uninstaller context (GetProcessInfo expansion errors),
  ; so we scope the whole body to the installer. Cost: the STANDALONE uninstaller
  ; skips its running-app check (manual uninstall-while-running may leave a locked
  ; file) — minor; UPDATES are unaffected (they use installSection's
  ; uninstallOldVersion, not this hook).
  !ifndef BUILD_UNINSTALLER
    !insertmacro paintTitleBarNavy
    !insertmacro _CHECK_APP_RUNNING
  !endif
!macroend
