; CumulusVPN NSIS installer hooks (bundle > windows > nsis > installerHooks).
;
; Installs the privileged helper next to the app and registers it as the
; CumulusVPNHelper service (LocalSystem, automatic start, restart on failure);
; removes it on uninstall. The app then runs as a normal user and drives the
; service over \\.\pipe\CumulusVPN.Helper (see helper/src/windows.rs).
;
; The installer is per-machine (tauri.windows.conf.json): a LocalSystem
; service must never run an executable from a directory its users can write,
; and the service only serves the app that sits next to it in that directory.
;
; The MSI does the same with native ServiceInstall / ServiceControl tables
; (windows/helper-service.wxs).

!define CVPN_SERVICE "CumulusVPNHelper"
!define CVPN_HELPER_EXE "cumulusvpn-helper.exe"
; Captured here, while this file is being included, so it names this file's
; directory rather than that of the generated installer.nsi that inserts the
; macros. scripts/build-helper.mjs stages the binary there before bundling.
!define CVPN_HELPER_SRC "${__FILEDIR__}\..\helper\build\cumulusvpn-helper.exe"
!define CVPN_POWERSHELL '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command'

; Stop the service if it exists. Stop-Service waits until it has stopped, and
; the service disconnects (DNS, devices, kill switch) before it does. Needed
; before files are replaced: Windows will not overwrite a running executable,
; and the service holds both its own and wireguard-go.exe.
!macro CVPN_STOP_SERVICE
  nsExec::ExecToLog '${CVPN_POWERSHELL} "Stop-Service -Name ${CVPN_SERVICE} -Force -ErrorAction SilentlyContinue"'
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro CVPN_STOP_SERVICE
!macroend

!macro NSIS_HOOK_POSTINSTALL
  SetOutPath "$INSTDIR"
  File "/oname=${CVPN_HELPER_EXE}" "${CVPN_HELPER_SRC}"

  ; Register the service, or re-point an existing registration at this
  ; install. The image path is quoted: an unquoted path with spaces is a
  ; classic service hijack.
  nsExec::ExecToLog '"$SYSDIR\sc.exe" query ${CVPN_SERVICE}'
  Pop $0
  ${If} $0 == 0
    nsExec::ExecToLog '"$SYSDIR\sc.exe" config ${CVPN_SERVICE} binPath= "\"$INSTDIR\${CVPN_HELPER_EXE}\"" start= auto obj= LocalSystem DisplayName= "CumulusVPN Helper"'
  ${Else}
    nsExec::ExecToLog '"$SYSDIR\sc.exe" create ${CVPN_SERVICE} binPath= "\"$INSTDIR\${CVPN_HELPER_EXE}\"" start= auto obj= LocalSystem DisplayName= "CumulusVPN Helper"'
  ${EndIf}
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "CumulusVPN could not register its background service (sc.exe exit code $0). Run the installer again as an administrator." /SD IDOK
  ${EndIf}
  nsExec::ExecToLog '"$SYSDIR\sc.exe" description ${CVPN_SERVICE} "Runs the CumulusVPN tunnel, routes, kill switch and DNS so the app does not need administrator rights."'
  Pop $0
  ; Restart after 1s, 1s, then 5s; forget failures after a day without one.
  nsExec::ExecToLog '"$SYSDIR\sc.exe" failure ${CVPN_SERVICE} reset= 86400 actions= restart/1000/restart/1000/restart/5000'
  Pop $0
  nsExec::ExecToLog '"$SYSDIR\sc.exe" start ${CVPN_SERVICE}'
  Pop $0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CVPN_STOP_SERVICE
  ${If} $UpdateMode <> 1
    ; A real uninstall: undo anything a crashed session left behind (a kill
    ; switch would otherwise keep blocking with nothing left to lift it), then
    ; remove the service.
    nsExec::ExecToLog '"$INSTDIR\${CVPN_HELPER_EXE}" --cleanup'
    Pop $0
    nsExec::ExecToLog '"$SYSDIR\sc.exe" delete ${CVPN_SERVICE}'
    Pop $0
  ${EndIf}
  ; Installed by the hook above, so not in Tauri's own file list.
  Delete "$INSTDIR\${CVPN_HELPER_EXE}"
!macroend
