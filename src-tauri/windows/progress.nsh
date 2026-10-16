; Optional phase reporting for the React installer. Normal updates are unchanged.
Var MokiProgressPath
!macro MokiReport PERCENT STAGE
  Push $0
  ${If} $MokiProgressPath != ""
    ClearErrors
    FileOpen $0 "$MokiProgressPath" a
    ${IfNot} ${Errors}
      FileWrite $0 "${PERCENT}|${STAGE}$\r$\n"
      FileClose $0
    ${EndIf}
  ${EndIf}
  Pop $0
!macroend
Function MokiInitProgress
  ${GetOptions} $CMDLINE "/MOKI_PROGRESS=" $MokiProgressPath
  !insertmacro MokiReport 5 preparing
FunctionEnd
