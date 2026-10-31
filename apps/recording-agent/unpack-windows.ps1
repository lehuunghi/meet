$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Archive=[IO.Compression.ZipFile]::OpenRead($env:MEET_UPDATE_ARCHIVE)
try {
 $Total=0L
 foreach($Entry in $Archive.Entries){
  $Name=$Entry.FullName.Replace('\','/');$Total+=$Entry.Length
  if($Total -gt 4GB -or $Name.StartsWith('/') -or $Name.Contains(':') -or ($Name.Split('/') -contains '..') -or ($Name.Split('/')[0] -ne 'meet-recorder-win32-x64') -or (($Entry.ExternalAttributes -shr 16) -band 61440) -eq 40960){throw 'Invalid update payload'}
 }
} finally {$Archive.Dispose()}
Expand-Archive -LiteralPath $env:MEET_UPDATE_ARCHIVE -DestinationPath $env:MEET_UPDATE_STAGE
