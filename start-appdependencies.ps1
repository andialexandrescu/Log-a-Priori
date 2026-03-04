$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$workflowAppPath = Join-Path $scriptRoot "workflow-app"
$updateTunnelsScriptPath = Join-Path $scriptRoot "update-tunnels.ps1"
$functionAppName = "log-a-priori-github-webhook"
$nextPort = 3000
$envLocalPath = Join-Path $workflowAppPath ".env.local"
function Get-DotEnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string]$Key
    )

    if (-not (Test-Path $FilePath)) {
        return $null
    }

    $line = Get-Content -Path $FilePath -ErrorAction SilentlyContinue |
        Where-Object { $_ -match "^\s*$Key\s*=" } |
        Select-Object -First 1

    if (-not $line) {
        return $null
    }

    $value = ($line -split '=', 2)[1].Trim()
    $value = $value.Trim('"').Trim("'")
    return $value
}

$pocketBasePath = Get-DotEnvValue -FilePath $envLocalPath -Key "POCKETBASE_PATH"
if (-not $pocketBasePath) {
    $pocketBasePath = $env:POCKETBASE_PATH
}
$pocketBaseExe = Join-Path $pocketBasePath "pocketbase.exe"

Write-Host "Starting app dependencies" -ForegroundColor Green
Write-Host "PocketBase path: $pocketBasePath" -ForegroundColor Cyan
Write-Host "Workflow app path: $workflowAppPath" -ForegroundColor Cyan

$pocketbaseProcess = $null
$nextProcess = $null
$updateTunnelsProcess = $null
$resourceGroupName = $null

function Ensure-AzureFunctionRunning {
    param(
        [Parameter(Mandatory = $true)][string]$FunctionAppName
    )

    Write-Host "Starting Azure Function App in cloud" -ForegroundColor Yellow
    $resourceGroup = az functionapp list --query "[?name=='$FunctionAppName'].resourceGroup | [0]" -o tsv
    az functionapp start --name $FunctionAppName --resource-group $resourceGroup | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Azure Function App start failed with exit code $LASTEXITCODE"
    }

    $maxChecks = 10
    $check = 0
    do {
        Start-Sleep -Seconds 5
        $state = az functionapp show --name $FunctionAppName --resource-group $resourceGroup --query state -o tsv
        $check++ # once the state is running, it's a definitive response
    } while ($state -ne "Running" -and $check -lt $maxChecks)

    if ($state -ne "Running") {
        throw "Azure Function App is not running after start, current state: $state"
    }

    Write-Host "Azure Function App is running" -ForegroundColor Green
    return $resourceGroup
}

function Wait-LocalService {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Name,
        [int]$TimeoutSeconds = 90
    )

    $elapsed = 0
    while ($elapsed -lt $TimeoutSeconds) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                Write-Host "$Name is reachable at $Url" -ForegroundColor Green
                return
            }
        }
        catch {
            $httpResponse = $_.Exception.Response
            if ($httpResponse) {
                Write-Host "$Name is reachable at $Url" -ForegroundColor Green
                return
            }
        }

        Start-Sleep -Seconds 2
        $elapsed += 2
    }

    throw "$Name is not reachable on $Url after $TimeoutSeconds seconds"
}

function Test-PortAvailable {
    param([Parameter(Mandatory = $true)][int]$Port)

    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        $listener.Stop()
        return $true
    }
    catch {
        return $false
    }
}

try {
    Write-Host "Starting PocketBase (pocketbase.exe serve)" -ForegroundColor Yellow
    $pocketbaseProcess = Start-Process -FilePath $pocketBaseExe -ArgumentList "serve" -WorkingDirectory $pocketBasePath -NoNewWindow -PassThru

    if (-not (Test-PortAvailable -Port $nextPort)) {
        throw "Port 3000 is already in use, the Next.js application must run on port 3000, it is advised to kill the process before running this start-appdependencies.ps1 script again"
    }

    Write-Host "Starting Next.js on port $nextPort (npm run dev)..." -ForegroundColor Yellow
    $nextProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/c set PORT=$nextPort && npm run dev" -WorkingDirectory $workflowAppPath -NoNewWindow -PassThru

    Wait-LocalService -Url "http://127.0.0.1:8090" -Name "PocketBase" -TimeoutSeconds 90
    Wait-LocalService -Url "http://127.0.0.1:$nextPort" -Name "Next.js" -TimeoutSeconds 90

    Write-Host "Starting update-tunnels.ps1" -ForegroundColor Yellow
    $updateTunnelsProcess = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $updateTunnelsScriptPath, "-NextLocalUrl", "http://127.0.0.1:$nextPort", "-PocketBaseLocalUrl", "http://127.0.0.1:8090") -WorkingDirectory $scriptRoot -NoNewWindow -PassThru

    Write-Host "Waiting for tunnels and environment variables publish to complete" -ForegroundColor Yellow
    Start-Sleep -Seconds 25

    $resourceGroupName = Ensure-AzureFunctionRunning -FunctionAppName $functionAppName

    Start-Sleep -Seconds 5

    $pocketRunning = Get-Process -Id $pocketbaseProcess.Id -ErrorAction SilentlyContinue
    $nextRunning = Get-Process -Id $nextProcess.Id -ErrorAction SilentlyContinue
    $updateTunnelsRunning = Get-Process -Id $updateTunnelsProcess.Id -ErrorAction SilentlyContinue

    if (-not $pocketRunning -or -not $nextRunning -or -not $updateTunnelsRunning) {
        throw "One of the startup processes failed to start"
    }

    Write-Host "The start-appdependencies.ps1 script finished running all dependencies and tunnels, press Ctrl+C to stop" -ForegroundColor Green

    while ($true) {
        Start-Sleep -Seconds 5

        $pocketRunning = Get-Process -Id $pocketbaseProcess.Id -ErrorAction SilentlyContinue
        $nextRunning = Get-Process -Id $nextProcess.Id -ErrorAction SilentlyContinue
        $updateTunnelsRunning = Get-Process -Id $updateTunnelsProcess.Id -ErrorAction SilentlyContinue

        if (-not $pocketRunning -or -not $nextRunning -or -not $updateTunnelsRunning) {
            Write-Host "One of the managed processes stopped running unexpectedly" -ForegroundColor Red
            break
        }
    }
}
catch {
    Write-Host "$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    Write-Host "Stopping managed processes" -ForegroundColor Yellow

    if ($updateTunnelsProcess) {
        Stop-Process -Id $updateTunnelsProcess.Id -Force -ErrorAction SilentlyContinue
    }

    if ($nextProcess) {
        Stop-Process -Id $nextProcess.Id -Force -ErrorAction SilentlyContinue
    }

    if ($pocketbaseProcess) {
        Stop-Process -Id $pocketbaseProcess.Id -Force -ErrorAction SilentlyContinue
    }

    Write-Host "Local processes stopped" -ForegroundColor Green

    $resourceGroupName = az functionapp list --query "[?name=='$functionAppName'].resourceGroup | [0]" -o tsv
    if ($resourceGroupName) {
        Write-Host "Stopping Azure Function App in cloud..." -ForegroundColor Yellow
        az functionapp stop --name $functionAppName --resource-group $resourceGroupName | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Azure Function App stopped" -ForegroundColor Green
        }
        else {
            Write-Host "Failed to stop Azure Function App (exit code $LASTEXITCODE)" -ForegroundColor Red
        }
    }
}