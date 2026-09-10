param([string]$InputPath, [string]$OutputPath)
$ErrorActionPreference = 'Stop'
$speechRequest = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
$speechVoice = New-Object -ComObject SAPI.SpVoice
$available = $speechVoice.GetVoices()
$voicePattern = if ($speechRequest.language -eq 'en') { 'English' } else { 'Chinese|Huihui' }
$voiceFound = $false
for ($i = 0; $i -lt $available.Count; $i++) {
  if ($available.Item($i).GetDescription() -match $voicePattern) { $speechVoice.Voice = $available.Item($i); $voiceFound = $true; break }
}
if (-not $voiceFound) { throw 'Requested language voice is not installed.' }
$speechStream = New-Object -ComObject SAPI.SpFileStream
$speechStream.Format.Type = 22
$speechStream.Open($OutputPath, 3, $false)
try {
  $speechVoice.AudioOutputStream = $speechStream
  $speechVoice.Rate = if ($speechRequest.language -eq 'en') { -2 } else { 1 }
  [void]$speechVoice.Speak([string]$speechRequest.text)
} finally { $speechStream.Close() }
