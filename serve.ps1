param(
  [int]$Port = 8000
)

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

Write-Host "Serving $(Get-Location) at http://localhost:$Port/"
Write-Host "Press Ctrl+C to stop."

$mimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.js' = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.txt' = 'text/plain; charset=utf-8'
  '.png' = 'image/png'
  '.jpg' = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.svg' = 'image/svg+xml'
  '.ico' = 'image/x-icon'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
}

function Send-Response {
  param(
    [Parameter(Mandatory = $true)]
    [System.Net.Sockets.NetworkStream]$Stream,
    [Parameter(Mandatory = $true)]
    [int]$StatusCode,
    [Parameter(Mandatory = $true)]
    [string]$StatusText,
    [Parameter(Mandatory = $true)]
    [string]$ContentType,
    [long]$ContentLength = 0,
    [byte[]]$Body = @()
  )

  $headerText = @(
    "HTTP/1.1 $StatusCode $StatusText"
    "Content-Type: $ContentType"
    "Content-Length: $ContentLength"
    "Connection: close"
    ""
    ""
  ) -join "`r`n"

  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerText)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)

  if ($Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()

    try {
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()

      if ([string]::IsNullOrWhiteSpace($requestLine)) {
        continue
      }

      while (($headerLine = $reader.ReadLine()) -ne '') {
        if ($null -eq $headerLine) {
          break
        }
      }

      $parts = $requestLine -split ' '
      $method = $parts[0]
      $rawPath = if ($parts.Length -ge 2) { $parts[1] } else { '/' }

      if ($method -notin @('GET', 'HEAD')) {
        $body = [System.Text.Encoding]::UTF8.GetBytes('Method not allowed')
        Send-Response -Stream $stream -StatusCode 405 -StatusText 'Method Not Allowed' -ContentType 'text/plain; charset=utf-8' -ContentLength $body.Length -Body $body
        continue
      }

      $requestPath = [System.Uri]::UnescapeDataString(($rawPath -split '\?', 2)[0]).TrimStart('/')
      if ([string]::IsNullOrWhiteSpace($requestPath)) {
        $requestPath = 'index.html'
      }

      $localPath = Join-Path (Get-Location) $requestPath
      $resolvedPath = [System.IO.Path]::GetFullPath($localPath)
      $rootPath = [System.IO.Path]::GetFullPath((Get-Location).Path)

      if (-not $resolvedPath.StartsWith($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes('Forbidden')
        Send-Response -Stream $stream -StatusCode 403 -StatusText 'Forbidden' -ContentType 'text/plain; charset=utf-8' -ContentLength $body.Length -Body $body
        continue
      }

      if (-not (Test-Path $resolvedPath -PathType Leaf)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes('Not found')
        Send-Response -Stream $stream -StatusCode 404 -StatusText 'Not Found' -ContentType 'text/plain; charset=utf-8' -ContentLength $body.Length -Body $body
        continue
      }

      $extension = [System.IO.Path]::GetExtension($resolvedPath).ToLowerInvariant()
      $contentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { 'application/octet-stream' }
      $fileBytes = [System.IO.File]::ReadAllBytes($resolvedPath)
      $body = if ($method -eq 'HEAD') { @() } else { $fileBytes }

      Send-Response -Stream $stream -StatusCode 200 -StatusText 'OK' -ContentType $contentType -ContentLength $fileBytes.Length -Body $body
    }
    finally {
      if ($reader) {
        $reader.Dispose()
      }
      if ($stream) {
        $stream.Dispose()
      }
      $client.Close()
      $reader = $null
      $stream = $null
    }
  }
}
finally {
  $listener.Stop()
}
