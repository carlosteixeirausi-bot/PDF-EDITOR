#Requires -RunAsAdministrator
param(
  [string]$InstallDir = 'C:\PDF-EDITOR',
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072

$RepoUrl = 'https://github.com/carlosteixeirausi-bot/PDF-EDITOR.git'
$ZipUrl = 'https://github.com/carlosteixeirausi-bot/PDF-EDITOR/archive/refs/heads/main.zip'
$ServiceName = 'pdf-editor'
$LogFile = Join-Path $env:TEMP 'pdf-editor-install.log'

function Info([string]$Message) { Write-Host "`n[PDF-Editor] $Message" -ForegroundColor Cyan }
function Fail([string]$Message) { throw "[PDF-Editor] $Message" }

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Stop-PdfService([string]$Name) {
  $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if (-not $service -or $service.Status -eq 'Stopped') { return }
  & sc.exe stop $Name | Out-Null
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Service -Name $Name -ErrorAction SilentlyContinue).Status -ne 'Stopped' -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 1
  }
  $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if ($service -and $service.Status -ne 'Stopped') {
    $cim = Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction SilentlyContinue
    if ($cim -and $cim.ProcessId -gt 0) {
      Stop-Process -Id $cim.ProcessId -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
    }
  }
}

function Add-MachinePath([string]$Directory) {
  if (-not (Test-Path $Directory)) { return }
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $parts = @($machinePath -split ';' | Where-Object { $_ })
  if ($parts -notcontains $Directory) {
    [Environment]::SetEnvironmentVariable('Path', (($parts + $Directory) -join ';'), 'Machine')
  }
  if ((@($env:Path -split ';' | Where-Object { $_ })) -notcontains $Directory) {
    $env:Path = $env:Path.TrimEnd(';') + ';' + $Directory
  }
}

try {
  Start-Transcript -Path $LogFile -Force | Out-Null

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Fail 'Execute este script em um PowerShell como Administrador.'
  }

  Info 'Instalando Chocolatey, se necessário...'
  Refresh-Path
  if (-not (Get-Command choco.exe -ErrorAction SilentlyContinue)) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072
    Set-ExecutionPolicy Bypass -Scope Process -Force
    Invoke-Expression ((New-Object Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    Refresh-Path
  }

  Info 'Instalando Node.js, Ghostscript, QPDF, Poppler, Tesseract, LibreOffice, Git e NSSM...'
  & choco.exe install nodejs-lts ghostscript qpdf poppler tesseract libreoffice-fresh git nssm -y --no-progress
  if ($LASTEXITCODE -ne 0) { Fail "Chocolatey retornou código $LASTEXITCODE." }
  Refresh-Path

  Info 'Localizando programas instalados...'
  $candidates = @(
    'C:\Program Files\gs',
    'C:\Program Files\LibreOffice\program',
    'C:\Program Files\Tesseract-OCR'
  )
  foreach ($base in $candidates) {
    if (Test-Path $base) {
      $exe = Get-ChildItem -Path $base -Recurse -Filter '*.exe' -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in @('gswin64c.exe', 'soffice.exe', 'tesseract.exe') } |
        Select-Object -First 1
      if ($exe) { Add-MachinePath $exe.DirectoryName }
    }
  }
  Refresh-Path

  $missing = @()
  foreach ($cmd in @('node.exe', 'npm.cmd', 'qpdf.exe', 'gswin64c.exe', 'pdftoppm.exe', 'pdftotext.exe', 'tesseract.exe', 'soffice.exe', 'git.exe', 'nssm.exe')) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { $missing += $cmd }
  }
  if ($missing.Count -gt 0) {
    Fail "Programas não encontrados no PATH: $($missing -join ', '). Feche e abra um novo PowerShell como Administrador e execute novamente."
  }

  Info 'Instalando idioma português no Tesseract...'
  $tessExe = (Get-Command tesseract.exe).Source
  if ($tessExe -like '*chocolatey*' -and (Test-Path 'C:\Program Files\Tesseract-OCR\tesseract.exe')) {
    $tessExe = 'C:\Program Files\Tesseract-OCR\tesseract.exe'
  }
  $tessdata = Join-Path (Split-Path $tessExe) 'tessdata'
  $porFile = Join-Path $tessdata 'por.traineddata'
  if (-not (Test-Path $porFile)) {
    New-Item -ItemType Directory -Path $tessdata -Force | Out-Null
    Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/por.traineddata' -OutFile $porFile -UseBasicParsing
  }

  Info "Obtendo o projeto em $InstallDir..."
  if ((Test-Path (Join-Path $PSScriptRoot 'server.js')) -and (Test-Path (Join-Path $PSScriptRoot 'package.json'))) {
    $InstallDir = $PSScriptRoot
    Info "Usando o projeto atual: $InstallDir"
  } elseif (Test-Path (Join-Path $InstallDir '.git')) {
    & git.exe -C $InstallDir pull --ff-only
    if ($LASTEXITCODE -ne 0) { Fail 'Falha ao atualizar o repositório Git.' }
  } elseif (Test-Path $InstallDir) {
    $count = @(Get-ChildItem -Path $InstallDir -Force -ErrorAction SilentlyContinue).Count
    if ($count -gt 0) {
      Fail "$InstallDir já existe e não está vazio. Escolha outra pasta com -InstallDir."
    }
    & git.exe clone --depth 1 $RepoUrl $InstallDir
    if ($LASTEXITCODE -ne 0) { Fail 'Falha ao clonar o repositório.' }
  } else {
    & git.exe clone --depth 1 $RepoUrl $InstallDir
    if ($LASTEXITCODE -ne 0) {
      Info 'Git falhou; baixando arquivo ZIP...'
      $zip = Join-Path $env:TEMP 'pdf-editor-main.zip'
      Invoke-WebRequest -Uri $ZipUrl -OutFile $zip -UseBasicParsing
      New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
      Expand-Archive -Path $zip -DestinationPath $InstallDir -Force
      $sub = Get-ChildItem -Path $InstallDir -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'server.js') } | Select-Object -First 1
      if ($sub) {
        Get-ChildItem -Path $sub.FullName -Force | Move-Item -Destination $InstallDir -Force
        Remove-Item -Path $sub.FullName -Recurse -Force
      } else {
        Fail 'Não foi possível localizar server.js no arquivo baixado.'
      }
    }
  }

  Set-Location $InstallDir

  $configPath = Join-Path $InstallDir 'config.env'
  if (-not $PSBoundParameters.ContainsKey('Port') -and (Test-Path $configPath)) {
    $portLine = Get-Content $configPath | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -First 1
    if ($portLine) { $Port = [int](($portLine -split '=', 2)[1].Trim()) }
  }
  @("HOST=0.0.0.0", "PORT=$Port") | Set-Content -Path $configPath -Encoding ASCII

  Info 'Instalando dependências Node.js...'
  & npm.cmd install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail "npm install retornou código $LASTEXITCODE." }

  Info 'Configurando serviço do Windows...'
  $nodeExe = (Get-Command node.exe).Source
  $nssm = (Get-Command nssm.exe).Source
  $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($existing) {
    Stop-PdfService $ServiceName
    & $nssm set $ServiceName Application $nodeExe
    & $nssm set $ServiceName AppParameters 'server.js'
  } else {
    & $nssm install $ServiceName $nodeExe 'server.js'
    if ($LASTEXITCODE -ne 0) { Fail 'Falha ao criar o serviço com NSSM.' }
  }

  & $nssm set $ServiceName AppDirectory $InstallDir
  & $nssm set $ServiceName AppEnvironmentExtra "HOST=0.0.0.0" "PORT=$Port" "NODE_ENV=production"
  & $nssm set $ServiceName Start SERVICE_AUTO_START
  & $nssm set $ServiceName AppStdout (Join-Path $InstallDir 'pdf-editor.log')
  & $nssm set $ServiceName AppStderr (Join-Path $InstallDir 'pdf-editor.log')
  & $nssm set $ServiceName AppRotateFiles 1
  & $nssm set $ServiceName AppRotateOnline 1
  & $nssm set $ServiceName AppRotateBytes 10485760
  & $nssm set $ServiceName AppStopMethodSkip 7
  & $nssm set $ServiceName DisplayName 'PDF-Editor'
  & $nssm set $ServiceName Description 'Ferramentas PDF locais acessiveis pela rede'

  Info "Liberando a porta $Port no firewall do Windows..."
  Get-NetFirewallRule -DisplayName 'PDF-Editor*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName "PDF-Editor (TCP $Port)" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Domain,Private | Out-Null

  Info 'Iniciando o serviço...'
  Start-Service -Name $ServiceName
  Start-Sleep -Seconds 4
  $service = Get-Service -Name $ServiceName
  if ($service.Status -ne 'Running') {
    Fail "O serviço não iniciou. Veja o log em $InstallDir\pdf-editor.log"
  }

  $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 15
  if ($health.StatusCode -ne 200) { Fail "O servidor respondeu HTTP $($health.StatusCode)." }

  $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -First 1).IPAddress
  if (-not $ip) { $ip = 'IP_DO_SERVIDOR' }

  Info 'Instalação concluída. O PDF-Editor está rodando e inicia com o Windows.'
  Write-Host "  Pasta:           $InstallDir"
  Write-Host "  Este servidor:   http://127.0.0.1:$Port"
  Write-Host "  Rede local:      http://${ip}:$Port"
  Write-Host ''
  Write-Host "  Status:  Get-Service $ServiceName"
  Write-Host "  Logs:    Get-Content '$InstallDir\pdf-editor.log' -Tail 50 -Wait"
  Write-Host "  Parar:   Stop-Service $ServiceName"
  Write-Host "  Log da instalação: $LogFile"
} catch {
  Write-Host "`n[PDF-Editor] ERRO: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Log: $LogFile"
  exit 1
} finally {
  Stop-Transcript | Out-Null
}
