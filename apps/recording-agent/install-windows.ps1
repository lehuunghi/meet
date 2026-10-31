# Run the reviewed release's installer as Administrator. No remote script execution.
$ErrorActionPreference = 'Stop'
$MeetInstallRoot = Join-Path $env:ProgramData 'MeetRecorder'
$MeetAppRoot = Join-Path $MeetInstallRoot 'app'
$MeetDataRoot = Join-Path $MeetInstallRoot 'data'
$MeetExisting = Test-Path -LiteralPath (Join-Path $MeetDataRoot 'identity.json')
if ((Get-ScheduledTask -TaskName 'MeetRecorder' -ErrorAction SilentlyContinue).State -eq 'Running') { throw 'Ngừng nhận lớp, đợi hoàn tất ghi/tải rồi dừng tác vụ MeetRecorder trước khi cập nhật.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'runtime/node.exe'))) { throw 'Thiếu runtime. Dùng gói phát hành Windows đầy đủ.' }
$MeetOrigin = $env:MEET_SETUP_ORIGIN
if ($MeetExisting -and [string]::IsNullOrWhiteSpace($MeetOrigin)) { $MeetOrigin = Read-Host 'Xác nhận địa chỉ trung tâm HTTPS tin cậy để cập nhật' }
if ([string]::IsNullOrWhiteSpace($MeetOrigin)) { $MeetOrigin = Read-Host 'Địa chỉ Meet Server hoặc website trực tiếp (https://...)' }
if (-not $MeetExisting) {
if ($env:MEET_SETUP_CODE) { $MeetCode = ConvertTo-SecureString $env:MEET_SETUP_CODE -AsPlainText -Force } else { $MeetCode = Read-Host 'Mã đăng ký máy dùng một lần' -AsSecureString }
}
Remove-Item Env:MEET_SETUP_ORIGIN, Env:MEET_SETUP_CODE -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $MeetAppRoot, $MeetDataRoot | Out-Null
if ([IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') -ne [IO.Path]::GetFullPath($MeetAppRoot).TrimEnd('\')) { Get-ChildItem -LiteralPath $PSScriptRoot | Where-Object Name -ne 'data' | Copy-Item -Destination $MeetAppRoot -Recurse -Force }
& icacls.exe $MeetInstallRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)RX' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Không đặt được quyền thư mục.' }
& icacls.exe $MeetDataRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)M' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Không bảo vệ được dữ liệu.' }
$MeetAction = New-ScheduledTaskAction -Execute (Join-Path $MeetAppRoot 'runtime/node.exe') -Argument ('"' + (Join-Path $MeetAppRoot 'agent.mjs') + '" --data "' + $MeetDataRoot + '"') -WorkingDirectory $MeetAppRoot
$MeetTrigger = New-ScheduledTaskTrigger -AtStartup
$MeetPrincipal = New-ScheduledTaskPrincipal -UserId 'S-1-5-19' -LogonType ServiceAccount
$MeetSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 100 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
# Validate the actual non-interactive account, not just the installer user's desktop.
$MeetProbe = New-ScheduledTaskAction -Execute (Join-Path $MeetAppRoot 'runtime/node.exe') -Argument ('"' + (Join-Path $MeetAppRoot 'agent.mjs') + '" --self-test --data "' + $MeetDataRoot + '"') -WorkingDirectory $MeetAppRoot
Register-ScheduledTask -TaskName 'MeetRecorderProbe' -Action $MeetProbe -Principal $MeetPrincipal -Force | Out-Null
try {
    Start-ScheduledTask -TaskName 'MeetRecorderProbe'
    Start-Sleep -Seconds 2
    $MeetProbeDeadline = (Get-Date).AddSeconds(90)
    while ((Get-ScheduledTask -TaskName 'MeetRecorderProbe').State -eq 'Running' -and (Get-Date) -lt $MeetProbeDeadline) { Start-Sleep -Seconds 2 }
    if ((Get-ScheduledTask -TaskName 'MeetRecorderProbe').State -eq 'Running' -or (Get-ScheduledTaskInfo -TaskName 'MeetRecorderProbe').LastTaskResult -ne 0) { throw 'Không ghi được trong tài khoản nền. Chưa bật nhận lớp; kiểm tra quyền và chính sách máy.' }
} finally {
    Stop-ScheduledTask -TaskName 'MeetRecorderProbe' -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName 'MeetRecorderProbe' -Confirm:$false -ErrorAction SilentlyContinue
}
if (-not $MeetExisting) {
$env:MEET_ORIGIN = $MeetOrigin
$env:MEET_AGENT_DATA = $MeetDataRoot
$MeetCodePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($MeetCode)
try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($MeetCodePointer) | & (Join-Path $MeetAppRoot 'runtime/node.exe') (Join-Path $MeetAppRoot 'agent.mjs') --enroll
    if ($LASTEXITCODE -ne 0) { throw 'Đăng ký máy thất bại.' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($MeetCodePointer)
    Remove-Item Env:MEET_ORIGIN, Env:MEET_AGENT_DATA -ErrorAction SilentlyContinue
}
}
Register-ScheduledTask -TaskName 'MeetRecorder' -Action $MeetAction -Trigger $MeetTrigger -Principal $MeetPrincipal -Settings $MeetSettings -Force | Out-Null
# Start after the protected updater bootstrap is ready.
Write-Host 'Đã cài. Kiểm tra máy trực tuyến và thử ghi trong quản trị trước khi sử dụng chính thức.'

# The updater pins the explicitly confirmed origin/token in a separate protected folder.
$MeetUpdaterRoot = Join-Path $MeetInstallRoot 'updater'
$MeetIdentity = Get-Content -LiteralPath (Join-Path $MeetDataRoot 'identity.json') -Raw | ConvertFrom-Json
if ($MeetIdentity.origin.TrimEnd('/') -ne $MeetOrigin.TrimEnd('/')) { throw 'Địa chỉ trung tâm không khớp danh tính máy.' }
if (-not (Test-Path -LiteralPath $MeetUpdaterRoot)) {
 New-Item -ItemType Directory -Path $MeetUpdaterRoot | Out-Null
 & icacls.exe $MeetUpdaterRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
 if ($LASTEXITCODE -ne 0) { throw 'Không bảo vệ được bộ cập nhật.' }
 Copy-Item -LiteralPath (Join-Path $MeetAppRoot 'updater.mjs'), (Join-Path $MeetAppRoot 'unpack-windows.ps1') -Destination $MeetUpdaterRoot
 Copy-Item -LiteralPath (Join-Path $MeetAppRoot 'runtime') -Destination $MeetUpdaterRoot -Recurse
 $MeetIdentity | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $MeetUpdaterRoot 'trusted.json') -Encoding UTF8
}
'{"protocol":1}' | Set-Content -LiteralPath (Join-Path $MeetAppRoot 'updater-supported.json') -Encoding UTF8
$MeetUpdaterAction = New-ScheduledTaskAction -Execute (Join-Path $MeetUpdaterRoot 'runtime/node.exe') -Argument ('"' + (Join-Path $MeetUpdaterRoot 'updater.mjs') + '"') -WorkingDirectory $MeetUpdaterRoot
$MeetUpdaterTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$MeetUpdaterPrincipal = New-ScheduledTaskPrincipal -UserId 'S-1-5-18' -LogonType ServiceAccount -RunLevel Highest
$MeetUpdaterSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
if (-not (Get-ScheduledTask -TaskName 'MeetRecorderUpdater' -ErrorAction SilentlyContinue)) { Register-ScheduledTask -TaskName 'MeetRecorderUpdater' -Action $MeetUpdaterAction -Trigger $MeetUpdaterTrigger -Principal $MeetUpdaterPrincipal -Settings $MeetUpdaterSettings -Force | Out-Null }

Start-ScheduledTask -TaskName 'MeetRecorder'
