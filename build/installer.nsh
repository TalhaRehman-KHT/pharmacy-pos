; Included by electron-builder (electron-builder.json nsis.include).
;
; The uninstaller removes the program files only. It must never delete the pharmacy's records:
;   %APPDATA%\Pharmacy POS              the live database (pharmacy.db)
;   Documents\Pharmacy POS              backups, saved invoices, exported reports
; electron-builder leaves %APPDATA% alone while nsis.deleteAppDataOnUninstall is false (keep it false),
; and it never touches Documents. Nothing below deletes anything; this only tells the owner where the data is.
;
; /SD IDOK skips the message when the uninstaller runs silently, which is how an update replaces the old
; version, so updating never shows it.

!macro customUnInstall
  MessageBox MB_OK|MB_ICONINFORMATION "Uninstalling Pharmacy POS does not delete your pharmacy records. They stay on this computer:$\r$\n$\r$\nDatabase: %APPDATA%\Pharmacy POS$\r$\nBackups, invoices and reports: Documents\Pharmacy POS$\r$\n$\r$\nInstall Pharmacy POS again and it will open with all your data. Delete these folders yourself only if you are sure you no longer need them." /SD IDOK
!macroend
