# build.ps1
# Re-applies the graphicsConversions.h patch before every gradle build.
# RN 0.85.3's core header uses std::format which clashes with folly's
# format under our NDK; the gradle cache sometimes re-extracts the AAR
# which undoes the patch. This wrapper ensures the patch is always
# applied before the actual gradle call.
#
# Usage:
#   .\build.ps1                       # default: :app:assembleDebug
#   .\build.ps1 :app:bundleRelease
#   .\build.ps1 clean

param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ExtraArgs)

if (-not $ExtraArgs -or $ExtraArgs.Count -eq 0) {
    $ExtraArgs = @(':app:assembleDebug')
}

$pattern = 'return\s+std::format\("\{\}%",\s*dimension\.value\);'
$replacement = 'return std::to_string(dimension.value) + "%";'
$detect = 'std::format\("\{\}%"'

Write-Host "==> Patching graphicsConversions.h in gradle cache (if needed)..." -ForegroundColor Cyan

$patched = 0
Get-ChildItem -Path "$env:USERPROFILE\.gradle\caches" -Recurse -Filter 'graphicsConversions.h' -ErrorAction SilentlyContinue | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    if ($content -match $detect) {
        $newContent = $content -replace $pattern, $replacement
        Set-Content -Path $_.FullName -Value $newContent -NoNewline
        Write-Host "    patched: $($_.FullName)" -ForegroundColor Green
        $patched++
    }
}

if ($patched -eq 0) {
    Write-Host "    (no patch needed, already clean)" -ForegroundColor DarkGray
}

Write-Host "==> Running: .\gradlew $($ExtraArgs -join ' ')" -ForegroundColor Cyan
& .\gradlew @ExtraArgs
