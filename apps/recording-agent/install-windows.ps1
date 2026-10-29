# Run the reviewed release's installer as Administrator. No remote script execution.
$ErrorActionPreference = 'Stop'
$MeetInstallRoot = Join-Path $env:ProgramData 'MeetRecorder'
$MeetAppRoot = Join-Path $MeetInstallRoot 'app'
$MeetDataRoot = Join-Path $MeetInstallRoot 'data'
if (Test-Path -LiteralPath (Join-Path $MeetDataRoot 'identity.json')) { throw 'Máy đã đăng ký. Dừng tác vụ MeetRecorder trước khi cập nhật; giữ nguyên thư mục data.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'runtime/node.exe'))) { throw 'Thiếu runtime. Dùng gói phát hành Windows đầy đủ.' }
$MeetOrigin = Read-Host 'Website trường (https://...)'
$MeetCode = Read-Host 'Mã đăng ký máy dùng một lần' -AsSecureString
New-Item -ItemType Directory -Force -Path $MeetAppRoot, $MeetDataRoot | Out-Null
Get-ChildItem -LiteralPath $PSScriptRoot | Where-Object Name -ne 'data' | Copy-Item -Destination $MeetAppRoot -Recurse -Force
& icacls.exe $MeetInstallRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)RX' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Không đặt được quyền thư mục.' }
& icacls.exe $MeetDataRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)M' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Không bảo vệ được dữ liệu.' }
$MeetAction = New-ScheduledTaskAction -Execute (Join-Path $MeetAppRoot 'runtime/node.exe') -Argument ('"' + (Join-Path $MeetAppRoot 'agent.mjs') + '" --data "' + $MeetDataRoot + '"') -WorkingDirectory $MeetAppRoot
$MeetTrigger = New-ScheduledTaskTrigger -AtStartup
$MeetPrincipal = New-ScheduledTaskPrincipal -UserId 'S-1-5-19' -LogonType ServiceAccount
$MeetSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 100 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
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
Register-ScheduledTask -TaskName 'MeetRecorder' -Action $MeetAction -Trigger $MeetTrigger -Principal $MeetPrincipal -Settings $MeetSettings -Force | Out-Null
Start-ScheduledTask -TaskName 'MeetRecorder'
Write-Host 'Đã cài. Kiểm tra máy trực tuyến và thử ghi trong quản trị trước khi sử dụng chính thức.'
