#ifndef SourceDir
#define SourceDir "release\meet-recorder-win32-x64"
#endif
[Setup]
AppId={{A0EC10F7-21D9-46BD-AF8B-875042B863F8}
AppName=Meet Recorder
AppVersion=0.3.1
AppPublisher=Meet Server
DefaultDirName={commonappdata}\MeetRecorder\app
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=release
OutputBaseFilename=meet-recorder-windows-x64-setup
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Meet Recorder
CloseApplications=no
RestartApplications=no
[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Code]
var EnrollPage: TInputQueryWizardPage;
function SetEnv(Name, Value: string): Boolean;
  external 'SetEnvironmentVariableW@kernel32.dll stdcall';
function InitializeSetup(): Boolean;
begin
  Result := not FileExists(ExpandConstant('{commonappdata}\MeetRecorder\data\identity.json'));
  if not Result then MsgBox('Máy đã đăng ký. Dừng nhận lớp và giữ thư mục data trước khi cập nhật phần mềm máy ghi.', mbInformation, MB_OK);
end;
procedure InitializeWizard();
begin
  EnrollPage := CreateInputQueryPage(wpWelcome, 'Kết nối Meet Server', 'Đăng ký máy ghi một lần', 'Nhập địa chỉ trung tâm và mã dùng một lần lấy từ Cấu hình chung. Không nhập mật khẩu quản trị.');
  EnrollPage.Add('Địa chỉ trung tâm (https://...)', False);
  EnrollPage.Add('Mã đăng ký máy ghi (64 ký tự)', True);
end;
function NextButtonClick(CurPageID: Integer): Boolean;
var I: Integer; Code: string;
begin
  Result := True;
  if CurPageID <> EnrollPage.ID then Exit;
  Code := Trim(EnrollPage.Values[1]);
  Result := (Pos('https://', Lowercase(Trim(EnrollPage.Values[0]))) = 1) and (Length(Code) = 64);
  if Result then for I := 1 to Length(Code) do if Pos(Code[I], '0123456789abcdef') = 0 then Result := False;
  if not Result then MsgBox('Nhập domain HTTPS và mã đăng ký 64 ký tự hợp lệ.', mbError, MB_OK);
end;
procedure CurStepChanged(CurStep: TSetupStep);
var Status: Integer; Params: string;
begin
  if CurStep <> ssPostInstall then Exit;
  SetEnv('MEET_SETUP_ORIGIN', Trim(EnrollPage.Values[0]));
  SetEnv('MEET_SETUP_CODE', Trim(EnrollPage.Values[1]));
  try
    Params := '-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "' + ExpandConstant('{app}\install-windows.ps1') + '"';
    if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Params, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Status) then RaiseException('Không khởi động được bộ cài máy ghi.');
    if Status <> 0 then RaiseException('Chưa cài hoàn tất. Kiểm tra mã còn hạn, kết nối và khả năng ghi nền; máy chưa được bật nhận lớp.');
  finally
    SetEnv('MEET_SETUP_ORIGIN', ''); SetEnv('MEET_SETUP_CODE', '');
    EnrollPage.Values[1] := '';
  end;
end;
[UninstallRun]
Filename: "{sys}\schtasks.exe"; Parameters: "/End /TN MeetRecorder"; Flags: runhidden
Filename: "{sys}\schtasks.exe"; Parameters: "/Delete /TN MeetRecorder /F"; Flags: runhidden
