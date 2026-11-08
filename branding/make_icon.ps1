# Generates the AI Clip Studio app icon (ICO with PNG-compressed sizes).
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$outDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$icoPath = Join-Path $outDir "ai-clip-studio.ico"
$pngPath = Join-Path $outDir "ai-clip-studio-256.png"

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [Math]::Max(0, $r * 2)
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-IconPng([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $scale = $size / 256.0
  $purple = [System.Drawing.Color]::FromArgb(255, 137, 101, 245)
  $white = [System.Drawing.Color]::FromArgb(255, 244, 241, 252)

  $bg = New-RoundedPath 0 0 $size $size (56 * $scale)
  $bgBrush = New-Object System.Drawing.SolidBrush($purple)
  $g.FillPath($bgBrush, $bg)

  $frame = New-RoundedPath (50 * $scale) (64 * $scale) (156 * $scale) (128 * $scale) (22 * $scale)
  $whiteBrush = New-Object System.Drawing.SolidBrush($white)
  $g.FillPath($whiteBrush, $frame)

  $play = @(
    [System.Drawing.PointF]::new(108 * $scale, 94 * $scale),
    [System.Drawing.PointF]::new(108 * $scale, 162 * $scale),
    [System.Drawing.PointF]::new(170 * $scale, 128 * $scale)
  )
  $g.FillPolygon($bgBrush, $play)

  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $ms.ToArray()

  if ($size -eq 256) {
    [System.IO.File]::WriteAllBytes($pngPath, $bytes)
  }

  $bgBrush.Dispose()
  $whiteBrush.Dispose()
  $bg.Dispose()
  $frame.Dispose()
  $g.Dispose()
  $bmp.Dispose()
  $ms.Dispose()

  return ,$bytes
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = @()
foreach ($size in $sizes) {
  $images += [pscustomobject]@{ Size = $size; Bytes = (New-IconPng $size) }
}

$stream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$images.Count)
$offset = 6 + (16 * $images.Count)
foreach ($image in $images) {
  $dimension = if ($image.Size -ge 256) { 0 } else { $image.Size }
  $writer.Write([Byte]$dimension)
  $writer.Write([Byte]$dimension)
  $writer.Write([Byte]0)
  $writer.Write([Byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$image.Bytes.Length)
  $writer.Write([UInt32]$offset)
  $offset += $image.Bytes.Length
}
foreach ($image in $images) {
  $writer.Write($image.Bytes)
}
$writer.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $stream.ToArray())
$writer.Dispose()
$stream.Dispose()

Write-Host "Created $icoPath"
