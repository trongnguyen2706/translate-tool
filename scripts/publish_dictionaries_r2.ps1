param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$')][string]$Bucket,
  [ValidateSet('beta','stable')][string]$Channel = 'beta',
  [string]$Source = 'public/dictionaries',
  [string]$Wrangler = 'wrangler',
  [switch]$Publish
)
$ErrorActionPreference = 'Stop'
$dictionaryRoot = (Resolve-Path -LiteralPath $Source).Path
$manifestPath = Join-Path $dictionaryRoot 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$uploads = @()
foreach ($package in $manifest.packages) {
  foreach ($chunk in $package.chunks) {
    $target = [IO.Path]::GetFullPath((Join-Path $dictionaryRoot $chunk.url))
    if (-not $target.StartsWith($dictionaryRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Chunk path escapes the dictionary folder' }
    if ((Get-Item -LiteralPath $target).Length -ne $chunk.compressedBytes -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $chunk.checksumSha256) { throw "Invalid dictionary chunk: $($chunk.url)" }
    $uploads += [PSCustomObject]@{ Path=$target; Key=$chunk.url; Type='application/gzip' }
  }
}
$attribution = [IO.Path]::GetFullPath((Join-Path $dictionaryRoot $manifest.attributionUrl))
if (-not $attribution.StartsWith($dictionaryRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Attribution path escapes the dictionary folder' }
if (-not (Test-Path -LiteralPath $attribution)) { throw 'Publish attribution together with the data' }
$uploads += [PSCustomObject]@{ Path=$attribution; Key=$manifest.attributionUrl; Type='text/plain' }
$uploads = $uploads | Sort-Object Key -Unique
Write-Output "Verified $($uploads.Count) immutable files. Destination: $Bucket/$Channel. Manifest publishes last."
if (-not $Publish) { Write-Output 'Dry run only. Add -Publish after configuring Wrangler access to your R2 bucket.'; return }
$null = Get-Command $Wrangler -ErrorAction Stop
foreach ($upload in $uploads) {
  & $Wrangler r2 object put "$Bucket/$Channel/$($upload.Key)" --file $upload.Path --remote --content-type $upload.Type --cache-control 'public, max-age=31536000, immutable'
  if ($LASTEXITCODE -ne 0) { throw 'Upload interrupted. Manifest was not switched. Retry the same immutable files.' }
}
& $Wrangler r2 object put "$Bucket/$Channel/manifest.json" --file $manifestPath --remote --content-type 'application/json' --cache-control 'public, max-age=60'
if ($LASTEXITCODE -ne 0) { throw 'Could not publish the manifest' }
Write-Output 'Manifest published. Verify the custom HTTPS domain before giving its URL to users.'
