param([string]$InputPath, [string]$OutputPath)
$ErrorActionPreference = 'Stop'
$speechRequest = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
$speechVoice = New-Object -ComObject SAPI.SpVoice
$available = $speechVoice.GetVoices()
for ($i = 0; $i -lt $available.Count; $i++) {
  if ($available.Item($i).GetDescription() -match 'Chinese|Huihui') { $speechVoice.Voice = $available.Item($i); break }
}
$speechStream = New-Object -ComObject SAPI.SpFileStream
$speechStream.Format.Type = 22
$speechStream.Open($OutputPath, 3, $false)
try {
  $speechVoice.AudioOutputStream = $speechStream
  $speechVoice.Rate = 1
  [void]$speechVoice.Speak([string]$speechRequest.text)
} finally { $speechStream.Close() }
