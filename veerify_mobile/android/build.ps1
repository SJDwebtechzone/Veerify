# build.ps1
# Self-diagnosing gradle wrapper for the Veerify mobile project.
#
# What it does on every run:
#   1. Re-applies the graphicsConversions.h patch in the gradle cache
#      (RN 0.85.3 + NDK 26 std::format vs folly::format clash).
#   2. Runs gradle with the args you passed, capturing output to
#      build-error.log AND mirroring to the console.
#   3. If the build fails, auto-prints the "What went wrong" block plus
#      the surrounding context so you don't have to grep the log yourself.
#
# Usage:
#   .\build.ps1                       # default: :app:assembleDebug
#   .\build.ps1 :app:assembleRelease
#   .\build.ps1 clean
#   .\build.ps1 :app:assembleRelease --stacktrace
#
# Special flag: pass --deep-clean to wipe project-local caches first
# (helps when gradle caches a corrupted resource between runs).

param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ExtraArgs)

# ---------------------------------------------------------------------------
# Parse our own pseudo-flags out of ExtraArgs before they reach gradle.
# ---------------------------------------------------------------------------
$DeepClean = $false
$cleanedArgs = @()
foreach ($a in $ExtraArgs) {
    if ($a -eq '--deep-clean') { $DeepClean = $true } else { $cleanedArgs += $a }
}
if (-not $cleanedArgs -or $cleanedArgs.Count -eq 0) {
    $cleanedArgs = @(':app:assembleDebug')
}

# ---------------------------------------------------------------------------
# Optional: wipe project-local caches that gradle sometimes refuses to
# regenerate after we've patched a corrupted resource.
# ---------------------------------------------------------------------------
if ($DeepClean) {
    Write-Host "==> Deep clean: stopping daemon and wiping build outputs..." -ForegroundColor Cyan
    & .\gradlew --stop *>$null
    foreach ($p in @('app\build\generated', 'app\build\intermediates', 'app\build\outputs', 'app\.cxx', 'build')) {
        if (Test-Path $p) {
            Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue
            Write-Host "    cleared: $p" -ForegroundColor DarkGray
        }
    }
}

# ---------------------------------------------------------------------------
# 1. Patch graphicsConversions.h in the gradle cache.
# ---------------------------------------------------------------------------
$pattern     = 'return\s+std::format\("\{\}%",\s*dimension\.value\);'
$replacement = 'return std::to_string(dimension.value) + "%";'
$detect      = 'std::format\("\{\}%"'

Write-Host "==> Patching graphicsConversions.h (if needed)..." -ForegroundColor Cyan
$patched = 0
Get-ChildItem -Path "$env:USERPROFILE\.gradle\caches" -Recurse -Filter 'graphicsConversions.h' -ErrorAction SilentlyContinue | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    if ($content -match $detect) {
        try {
            # Gradle marks finalised cache files read-only. Clear that flag
            # so Set-Content doesn't silently fail.
            $fi = Get-Item $_.FullName
            if ($fi.IsReadOnly) { $fi.IsReadOnly = $false }
        } catch {}
        ($content -replace $pattern, $replacement) | Set-Content -Path $_.FullName -NoNewline
        # Verify the write actually took.
        $stillBroken = (Get-Content $_.FullName -Raw) -match $detect
        if ($stillBroken) {
            Write-Host "    FAILED:  $($_.FullName)" -ForegroundColor Red
        } else {
            Write-Host "    patched: $($_.FullName)" -ForegroundColor Green
            $patched++
        }
    }
}
if ($patched -eq 0) { Write-Host "    (no patch needed, already clean)" -ForegroundColor DarkGray }

# ---------------------------------------------------------------------------
# 2. Run gradle, capturing output to build-error.log and console.
# ---------------------------------------------------------------------------
$logFile = 'build-error.log'
Write-Host "==> Running: .\gradlew $($cleanedArgs -join ' ')" -ForegroundColor Cyan
Write-Host "    (output also captured to $logFile)" -ForegroundColor DarkGray

# Tee-Object mirrors to console AND saves to file.
& .\gradlew @cleanedArgs 2>&1 | Tee-Object -FilePath $logFile
$gradleExit = $LASTEXITCODE

# ---------------------------------------------------------------------------
# 3. On failure, auto-extract the error block.
# ---------------------------------------------------------------------------
if ($gradleExit -ne 0) {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Red
    Write-Host "BUILD FAILED -- diagnostic block below" -ForegroundColor Red
    Write-Host "================================================================" -ForegroundColor Red

    if (Test-Path $logFile) {
        # First show every C++ error: / fatal error: line with context. Those
        # are the lines that actually pinpoint why the build failed -- the
        # FAILURE: block usually shows only the failing TASK, not the cause.
        $cppErrors = Select-String -Path $logFile -Pattern 'error:|fatal error:' -Context 3,10
        if ($cppErrors) {
            Write-Host "--- C++ ERRORS (with context) ---" -ForegroundColor Yellow
            foreach ($hit in $cppErrors) {
                foreach ($pre in $hit.Context.PreContext)  { Write-Host $pre }
                Write-Host ($hit.Line) -ForegroundColor Red
                foreach ($post in $hit.Context.PostContext) { Write-Host $post }
                Write-Host ""
            }
        }

        # Then the FAILURE: block (still useful for non-C++ failures).
        $failures = Select-String -Path $logFile -Pattern 'FAILURE:' -Context 0,80
        if ($failures) {
            Write-Host "--- FAILURE BLOCK ---" -ForegroundColor Yellow
            foreach ($hit in $failures) {
                Write-Host ($hit.Line) -ForegroundColor Yellow
                foreach ($post in $hit.Context.PostContext) { Write-Host $post }
                Write-Host ""
            }
        }

        if (-not $cppErrors -and -not $failures) {
            Write-Host "(no recognised error markers -- last 80 lines instead)" -ForegroundColor Yellow
            Get-Content $logFile -Tail 80 | ForEach-Object { Write-Host $_ }
        }
    } else {
        Write-Host "(no log file -- check console output above)" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "Full log: $((Resolve-Path $logFile).Path)" -ForegroundColor DarkGray
    exit $gradleExit
}

Write-Host ""
Write-Host "==> BUILD SUCCESSFUL" -ForegroundColor Green
