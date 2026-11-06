# Runs ON WINDOWS (PowerShell 5.1+): one command to try the whole chain. Same as run.sh.
#   1. copies scripts/pi-run.sh to the Pi
#   2. over one SSH connection: forwards a local port to pi-service AND starts
#      llama-server + pi-service on the Pi (via pi-run.sh)
#   3. waits until the Pi answers, then starts the Vite chatbox
# Ctrl-C stops everything, including the processes on the Pi.
#
#   scripts\run.cmd
#   $env:PI_HOST = "edgelm@192.168.22.73"; scripts\run.cmd     # if edgelm.local does not resolve
#
# Needs: OpenSSH client (built into Windows 10/11), Node.js. Set up an SSH key first
# (see README) so ssh does not need to ask for a password.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$PiHost = if ($env:PI_HOST) { $env:PI_HOST } else { 'edgelm@edgelm.local' }
$LocalPort = if ($env:LOCAL_PORT) { $env:LOCAL_PORT } else { '3000' }  # pi-service listens on 3000 on the Pi

foreach ($tool in 'ssh', 'scp', 'npm') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "run: '$tool' not found. Install the Windows 'OpenSSH Client' feature / Node.js."
    }
}

if (-not (Test-Path 'node_modules')) {
    Write-Host 'run: npm install'
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'run: npm install failed' }
}

# Git on Windows may have turned the script's line endings into CRLF, which breaks bash on the Pi.
# Copy an LF-only version. (scp needs a relative path: "C:" would be read as a host name.)
$tmpDir = [IO.Path]::GetTempPath()
$text = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'pi-run.sh')) -replace "`r`n", "`n"
[IO.File]::WriteAllText((Join-Path $tmpDir 'pi-run.sh'), $text, (New-Object Text.UTF8Encoding $false))
Write-Host "run: copying pi-run.sh to $PiHost"
Push-Location $tmpDir
try { scp -q 'pi-run.sh' "${PiHost}:pi-run.sh" } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw 'run: scp failed (is the Pi reachable? is PI_HOST right?)' }

function Show-PiLog {
    Write-Host 'run: last lines of the Pi log (~/pet-run.log):' -ForegroundColor Yellow
    ssh $PiHost 'tail -n 20 ~/pet-run.log'
}

$ssh = $null
try {
    Write-Host 'run: starting the Pi side (log on the Pi: ~/pet-run.log)'
    # ssh's stdin is a pipe we keep open. When this script exits (or ssh dies) it closes,
    # and pi-run.sh sees EOF and shuts the Pi side down.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = (Get-Command ssh).Source
    $psi.Arguments = "-o ExitOnForwardFailure=yes -o ServerAliveInterval=5 -L ${LocalPort}:127.0.0.1:3000 $PiHost `"WATCH_STDIN=1 bash ~/pi-run.sh > ~/pet-run.log 2>&1`""
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $ssh = [System.Diagnostics.Process]::Start($psi)

    Write-Host 'run: waiting for the Pi (model load takes a few seconds)'
    $ready = $false
    for ($i = 0; $i -lt 150; $i++) {
        if ($ssh.HasExited) {
            Write-Host 'run: the Pi side stopped.' -ForegroundColor Red
            Show-PiLog
            exit 1
        }
        try {
            $h = Invoke-RestMethod -Uri "http://127.0.0.1:$LocalPort/v1/health" -TimeoutSec 2
            if ($h.llama_configured -eq $true) { $ready = $true; break }
        } catch { }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) {
        Write-Host 'run: the Pi did not come up in time.' -ForegroundColor Red
        Show-PiLog
        exit 1
    }

    Write-Host 'run: Pi is up. Starting the chatbox, open http://localhost:5173  (Ctrl-C to stop everything)'
    $env:PI_URL = "http://127.0.0.1:$LocalPort"
    npm run web
}
finally {
    if ($ssh -and -not $ssh.HasExited) {
        try { $ssh.StandardInput.Close() } catch { }
        Start-Sleep -Milliseconds 500
        if (-not $ssh.HasExited) { try { $ssh.Kill() } catch { } }
    }
}
