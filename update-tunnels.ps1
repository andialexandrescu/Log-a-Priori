param(
    [string]$NextLocalUrl = "http://127.0.0.1:3000",
    [string]$PocketBaseLocalUrl = "http://127.0.0.1:8090"
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path # the full path of the update-tunnels.ps1 file
$settingsPath = Join-Path $scriptRoot "workflow-app\github-webhook\local.settings.json" # first relative subpath
$envPath = Join-Path $scriptRoot "workflow-app\.env.local" # second one
$functionsProjectPath = Join-Path $scriptRoot "workflow-app\github-webhook"
$waitTime = 15
$tempDir = $env:TEMP

Write-Host "Starting Cloudflare tunnels" -ForegroundColor Green
Write-Host "Next.js local url: $NextLocalUrl" -ForegroundColor Cyan
Write-Host "PocketBase local url: $PocketBaseLocalUrl" -ForegroundColor Cyan

function Test-LocalService {
    param(
        [Parameter(Mandatory = $true)][string]$Url
    )

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
    }
    catch {
        $httpResponse = $_.Exception.Response
        if ($httpResponse) {
            return $true
        }
        return $false
    }
}

function Wait-LocalService {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Name,
        [int]$TimeoutSeconds = 60
    )

    $elapsed = 0
    while ($elapsed -lt $TimeoutSeconds) {
        if (Test-LocalService -Url $Url) {
            return $true
        }
        Start-Sleep -Seconds 2
        $elapsed += 2
    }

    Write-Host "$Name is not reachable on $Url" -ForegroundColor Red
    return $false
}

function Update-EnvVar {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    $newLine = "$Name=$Value"

    $content = Get-Content -Path $FilePath -Raw -ErrorAction SilentlyContinue
    if ($null -eq $content) {
        $content = ""
    }

    $pattern = "(?m)^$([regex]::Escape($Name))=.*$"
    if ($content -match $pattern) {
        $updated = [regex]::Replace($content, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $newLine }, 1)
    }
    else {
        if ($content.Length -gt 0 -and -not $content.EndsWith("`r`n") -and -not $content.EndsWith("`n")) {
            $content += "`r`n"
        }
        $updated = "$content$newLine"
    }

    Set-Content -Path $FilePath -Value $updated -Encoding UTF8
}

function Update-JsonValues {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][hashtable]$Updates
    )

    $json = Get-Content -Path $FilePath -Raw | ConvertFrom-Json
    foreach ($entry in $Updates.GetEnumerator()) {
        if ($null -eq $json.Values.PSObject.Properties[$entry.Key]) {
            $json.Values | Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value
        }
        else {
            $json.Values.$($entry.Key) = $entry.Value
        }
    }

    $json | ConvertTo-Json -Depth 10 | Set-Content -Path $FilePath -Encoding UTF8
}

function Update-EnvVars {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][hashtable]$Updates
    )

    foreach ($entry in $Updates.GetEnumerator()) {
        Update-EnvVar -FilePath $FilePath -Name $entry.Key -Value $entry.Value
    }
}

$nextLog = "$tempDir\tunnel_next.log" # temp files for logging
$pocketLog = "$tempDir\tunnel_pocket.log"
# cloudflared writes the quick tunnel url to stderr, not stdout
Write-Host "Starting Next.js tunnel ($NextLocalUrl)" -ForegroundColor Yellow
$nextProcess = Start-Process -FilePath "cloudflared" -ArgumentList "tunnel --url $nextLocalUrl" -NoNewWindow -PassThru -RedirectStandardOutput $nextLog -RedirectStandardError "${nextLog}.err"
Write-Host "Starting PocketBase tunnel ($PocketBaseLocalUrl)" -ForegroundColor Yellow
$pocketProcess = Start-Process -FilePath "cloudflared" -ArgumentList "tunnel --url $pocketBaseLocalUrl" -NoNewWindow -PassThru -RedirectStandardOutput $pocketLog -RedirectStandardError "${pocketLog}.err"

Write-Host "Waiting for tunnels to establish ($waitTime seconds)" -ForegroundColor Yellow
Start-Sleep -Seconds $waitTime

function Get-TunnelUrl { # it extracts cloudflare urls from those temp log files
    param([string[]]$LogFiles)
    
    foreach ($logFile in $LogFiles) {
        if (-not (Test-Path $logFile)) {
            continue
        }

        $logContent = Get-Content -Path $logFile -Raw -ErrorAction SilentlyContinue
        if ($logContent -match 'https://([a-zA-Z0-9_-]+)\.trycloudflare\.com') {
            return $matches[0]
        }
    }
    
    return $null
}

Write-Host "Extracting urls from logs" -ForegroundColor Green

$nextErrorLog = "${nextLog}.err"
$pocketErrorLog = "${pocketLog}.err"

$nextUrl = Get-TunnelUrl -LogFiles @($nextLog, $nextErrorLog)
$pocketUrl = Get-TunnelUrl -LogFiles @($pocketLog, $pocketErrorLog)

if (-not $nextUrl) {
    Write-Host "Next.js error: Failed to get url" -ForegroundColor Red
    Write-Host "Stdout log contents:" -ForegroundColor Red
    Get-Content -Path $nextLog -ErrorAction SilentlyContinue
    Write-Host "Stderr log contents:" -ForegroundColor Red
    Get-Content -Path $nextErrorLog -ErrorAction SilentlyContinue
}

if (-not $pocketUrl) {
    Write-Host "PocketBase error: Failed to get url" -ForegroundColor Red
    Write-Host "Stdout log contents:" -ForegroundColor Red
    Get-Content -Path $pocketLog -ErrorAction SilentlyContinue
    Write-Host "Stderr log contents:" -ForegroundColor Red
    Get-Content -Path $pocketErrorLog -ErrorAction SilentlyContinue
}

if (-not $nextUrl -or -not $pocketUrl) {
    Write-Host "Failed to get urls" -ForegroundColor Red
    Stop-Process -Id $nextProcess.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $pocketProcess.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

# both urls are found
Write-Host "Tunnels established successfully" -ForegroundColor Green
Write-Host "Next.js url: $nextUrl" -ForegroundColor Cyan
Write-Host "PocketBase url: $pocketUrl" -ForegroundColor Cyan

$settingsUpdates = @{
    BACKEND_BASE_URL = $nextUrl
    POCKETBASE_URL = $pocketUrl
}

$envUpdates = @{
    POCKETBASE_URL = $pocketUrl
}

try {
    Write-Host "Updating selected fields in $settingsPath" -ForegroundColor Yellow
    Update-JsonValues -FilePath $settingsPath -Updates $settingsUpdates

    Write-Host "Updating selected fields in $envPath" -ForegroundColor Yellow
    Update-EnvVars -FilePath $envPath -Updates $envUpdates
}
catch {
    Write-Host "$($_.Exception.Message)" -ForegroundColor Red
    Stop-Process -Id $nextProcess.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $pocketProcess.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "Updated $settingsPath" -ForegroundColor Green
Write-Host "Updated $envPath" -ForegroundColor Green

try {
    Write-Host "Publishing local.settings.json values to Azure Function App" -ForegroundColor Yellow
    Push-Location $functionsProjectPath
    func azure functionapp publish log-a-priori-github-webhook --publish-settings-only --overwrite-settings

    if ($LASTEXITCODE -ne 0) {
        throw "Azure settings publish failed with exit code $LASTEXITCODE"
    }

    Write-Host "Azure Function App settings updated successfully" -ForegroundColor Green
}
catch {
    Write-Host "$($_.Exception.Message)" -ForegroundColor Red
    Stop-Process -Id $nextProcess.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $pocketProcess.Id -Force -ErrorAction SilentlyContinue
    exit 1
}
finally {
    Pop-Location
}

Write-Host "The updated-tunnels.ps1 script finished running all tunnels" -ForegroundColor Yellow

try {
    while ($true) { # keep the script running
        Start-Sleep -Seconds 5
        
        $nextRunning = Get-Process -Id $nextProcess.Id -ErrorAction SilentlyContinue
        $pocketRunning = Get-Process -Id $pocketProcess.Id -ErrorAction SilentlyContinue
        
        if (-not $nextRunning -or -not $pocketRunning) {
            Write-Host "One of the tunnels has stopped running unexpectedly" -ForegroundColor Red
            break
        }
    }
}
finally {
    Remove-Item -Path $nextLog -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "${nextLog}.err" -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $pocketLog -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "${pocketLog}.err" -Force -ErrorAction SilentlyContinue

    Write-Host "Stopping tunnels" -ForegroundColor Yellow
    Stop-Process -Id $nextProcess.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $pocketProcess.Id -Force -ErrorAction SilentlyContinue
    Write-Host "Tunnels stopped" -ForegroundColor Green
}