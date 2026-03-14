[CmdletBinding()]
param(
    [switch]$CatalogOnly
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class PointerInterop {
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct CURSORINFO {
        public int cbSize;
        public int flags;
        public IntPtr hCursor;
        public POINT ptScreenPos;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct ICONINFO {
        [MarshalAs(UnmanagedType.Bool)]
        public bool fIcon;
        public int xHotspot;
        public int yHotspot;
        public IntPtr hbmMask;
        public IntPtr hbmColor;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct BITMAP {
        public int bmType;
        public int bmWidth;
        public int bmHeight;
        public int bmWidthBytes;
        public short bmPlanes;
        public short bmBitsPixel;
        public IntPtr bmBits;
    }

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetCursorInfo(ref CURSORINFO pci);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr LoadCursor(IntPtr hInstance, IntPtr lpCursorName);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetIconInfo(IntPtr hIcon, out ICONINFO piconinfo);

    [DllImport("gdi32.dll", SetLastError = true)]
    public static extern int GetObject(IntPtr hgdiobj, int cbBuffer, out BITMAP lpvObject);

    [DllImport("gdi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool DeleteObject(IntPtr hObject);
}
"@

$vkLeft = 0x01
$vkRight = 0x02
$vkControl = 0x11
$cursorShowingFlag = 0x00000001
$leftDown = $false
$rightDown = $false
$leftStartedAtMs = 0
$rightStartedAtMs = 0
$leftCtrlKey = $false
$rightCtrlKey = $false
$cursorHandleMap = @{
    'arrow' = [PointerInterop]::LoadCursor([IntPtr]::Zero, [IntPtr]32512)
    'ibeam' = [PointerInterop]::LoadCursor([IntPtr]::Zero, [IntPtr]32513)
    'wait' = [PointerInterop]::LoadCursor([IntPtr]::Zero, [IntPtr]32514)
    'crosshair' = [PointerInterop]::LoadCursor([IntPtr]::Zero, [IntPtr]32515)
    'resize-nwse' = [PointerInterop]::LoadCursor([IntPtr]::Zero, [IntPtr]32642)
    'resize-nesw' = [PointerInterop]::LoadCursor([IntPtr]::Zero, [IntPtr]32643)
    'resize-ew' = [PointerInterop]::LoadCursor([IntPtr]::Zero, [IntPtr]32644)
    'resize-ns' = [PointerInterop]::LoadCursor([IntPtr]::Zero, [IntPtr]32645)
    'move' = [PointerInterop]::LoadCursor([IntPtr]::Zero, [IntPtr]32646)
    'not-allowed' = [PointerInterop]::LoadCursor([IntPtr]::Zero, [IntPtr]32648)
    'hand' = [PointerInterop]::LoadCursor([IntPtr]::Zero, [IntPtr]32649)
    'help' = [PointerInterop]::LoadCursor([IntPtr]::Zero, [IntPtr]32651)
}
$emittedCursorKind = 'arrow'
$emittedHotspotRatioX = 0
$emittedHotspotRatioY = 0
$emittedCursorAppearanceId = ''
$emittedReferenceWidth = 0
$emittedReferenceHeight = 0
$pendingCursorKind = 'arrow'
$pendingHotspotRatioX = 0
$pendingHotspotRatioY = 0
$pendingCursorAppearanceId = ''
$pendingReferenceWidth = 0
$pendingReferenceHeight = 0
$pendingCursorSinceMs = 0

function Emit-CursorEvent(
    [string]$cursorKind,
    [double]$hotspotRatioX,
    [double]$hotspotRatioY,
    [string]$cursorAppearanceId,
    [string]$cursorImageDataUrl,
    [int]$referenceWidth,
    [int]$referenceHeight,
    [long]$occurredAtMs
) {
    $payload = @{
        type = 'cursor'
        cursorKind = $cursorKind
        hotspotRatioX = $hotspotRatioX
        hotspotRatioY = $hotspotRatioY
        cursorAppearanceId = $cursorAppearanceId
        cursorImageDataUrl = $cursorImageDataUrl
        referenceWidth = $referenceWidth
        referenceHeight = $referenceHeight
        occurredAtMs = $occurredAtMs
    } | ConvertTo-Json -Compress

    [Console]::WriteLine($payload)
}

function Get-DefaultCursorHotspotRatios([string]$cursorKind) {
    switch ($cursorKind) {
        'hand' { return @{ hotspotRatioX = 0.36; hotspotRatioY = 0.06 } }
        'ibeam' { return @{ hotspotRatioX = 0.5; hotspotRatioY = 0.5 } }
        'crosshair' { return @{ hotspotRatioX = 0.5; hotspotRatioY = 0.5 } }
        'move' { return @{ hotspotRatioX = 0.5; hotspotRatioY = 0.5 } }
        'resize-ew' { return @{ hotspotRatioX = 0.5; hotspotRatioY = 0.5 } }
        'resize-ns' { return @{ hotspotRatioX = 0.5; hotspotRatioY = 0.5 } }
        'resize-nesw' { return @{ hotspotRatioX = 0.5; hotspotRatioY = 0.5 } }
        'resize-nwse' { return @{ hotspotRatioX = 0.5; hotspotRatioY = 0.5 } }
        default { return @{ hotspotRatioX = 0; hotspotRatioY = 0 } }
    }
}

function Get-CursorImageDataUrl([IntPtr]$cursorHandle) {
    if ($cursorHandle -eq [IntPtr]::Zero) {
        return ''
    }

    $icon = $null
    $iconClone = $null
    $bitmap = $null
    $memoryStream = $null

    try {
        $icon = [System.Drawing.Icon]::FromHandle($cursorHandle)
        $iconClone = [System.Drawing.Icon]$icon.Clone()
        $bitmap = $iconClone.ToBitmap()
        $memoryStream = New-Object System.IO.MemoryStream
        $bitmap.Save($memoryStream, [System.Drawing.Imaging.ImageFormat]::Png)
        return 'data:image/png;base64,' + [Convert]::ToBase64String($memoryStream.ToArray())
    } catch {
        return ''
    } finally {
        if ($memoryStream) { $memoryStream.Dispose() }
        if ($bitmap) { $bitmap.Dispose() }
        if ($iconClone) { $iconClone.Dispose() }
    }
}

function Get-CursorDescriptorFromHandle([IntPtr]$cursorHandle, [string]$fallbackCursorKind = 'arrow') {
    if ($cursorHandle -eq [IntPtr]::Zero) {
        return @{
            cursorKind = $fallbackCursorKind
            cursorAppearanceId = ''
            cursorImageDataUrl = ''
            hotspotRatioX = 0
            hotspotRatioY = 0
            referenceWidth = 0
            referenceHeight = 0
        }
    }

    $cursorKind = $fallbackCursorKind
    $referenceWidth = 0
    $referenceHeight = 0

    foreach ($entry in $cursorHandleMap.GetEnumerator()) {
        if ($cursorHandle -eq $entry.Value) {
            $cursorKind = $entry.Key
            break
        }
    }

    $hotspotRatioX = 0
    $hotspotRatioY = 0
    $iconInfo = New-Object PointerInterop+ICONINFO

    if ([PointerInterop]::GetIconInfo($cursorHandle, [ref]$iconInfo)) {
        $bitmap = New-Object PointerInterop+BITMAP
        $bitmapHandle = if ($iconInfo.hbmColor -ne [IntPtr]::Zero) { $iconInfo.hbmColor } else { $iconInfo.hbmMask }
        $bitmapLoaded = $bitmapHandle -ne [IntPtr]::Zero -and
            [PointerInterop]::GetObject(
                $bitmapHandle,
                [Runtime.InteropServices.Marshal]::SizeOf([type][PointerInterop+BITMAP]),
                [ref]$bitmap
            ) -gt 0

        if ($bitmapLoaded) {
            $bitmapWidth = [Math]::Max(1, $bitmap.bmWidth)
            $bitmapHeight = if ($iconInfo.hbmColor -ne [IntPtr]::Zero) {
                [Math]::Max(1, $bitmap.bmHeight)
            } else {
                [Math]::Max(1, [Math]::Floor($bitmap.bmHeight / 2))
            }

            $referenceWidth = $bitmapWidth
            $referenceHeight = $bitmapHeight
            $hotspotRatioX = [Math]::Max(0, [Math]::Min(1, $iconInfo.xHotspot / $bitmapWidth))
            $hotspotRatioY = [Math]::Max(0, [Math]::Min(1, $iconInfo.yHotspot / $bitmapHeight))
        }

        if ($iconInfo.hbmColor -ne [IntPtr]::Zero) {
            [void][PointerInterop]::DeleteObject($iconInfo.hbmColor)
        }
        if ($iconInfo.hbmMask -ne [IntPtr]::Zero) {
            [void][PointerInterop]::DeleteObject($iconInfo.hbmMask)
        }
    }

    $defaultHotspotRatios = Get-DefaultCursorHotspotRatios $cursorKind
    if ($defaultHotspotRatios.hotspotRatioX -gt 0 -and $hotspotRatioX -le 0.0001) {
        $hotspotRatioX = $defaultHotspotRatios.hotspotRatioX
    }
    if ($defaultHotspotRatios.hotspotRatioY -gt 0 -and $hotspotRatioY -le 0.0001) {
        $hotspotRatioY = $defaultHotspotRatios.hotspotRatioY
    }

    return @{
        cursorKind = $cursorKind
        cursorAppearanceId = ('0x{0}' -f $cursorHandle.ToInt64().ToString('X'))
        cursorImageDataUrl = ''
        hotspotRatioX = [Math]::Round($hotspotRatioX, 4)
        hotspotRatioY = [Math]::Round($hotspotRatioY, 4)
        referenceWidth = $referenceWidth
        referenceHeight = $referenceHeight
    }
}

function Get-CursorDescriptor() {
    $cursorInfo = New-Object PointerInterop+CURSORINFO
    $cursorInfo.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][PointerInterop+CURSORINFO])

    if (-not [PointerInterop]::GetCursorInfo([ref]$cursorInfo)) {
        return @{
            cursorKind = 'arrow'
            cursorAppearanceId = ''
            cursorImageDataUrl = ''
            hotspotRatioX = 0
            hotspotRatioY = 0
            referenceWidth = 0
            referenceHeight = 0
        }
    }

    if (($cursorInfo.flags -band $cursorShowingFlag) -eq 0) {
        return @{
            cursorKind = 'arrow'
            cursorAppearanceId = ''
            cursorImageDataUrl = ''
            hotspotRatioX = 0
            hotspotRatioY = 0
            referenceWidth = 0
            referenceHeight = 0
        }
    }

    return Get-CursorDescriptorFromHandle $cursorInfo.hCursor 'arrow'
}

function Emit-CursorCatalog() {
    $catalog = foreach ($entry in $cursorHandleMap.GetEnumerator()) {
        $descriptor = Get-CursorDescriptorFromHandle $entry.Value $entry.Key
        $imageDataUrl = Get-CursorImageDataUrl $entry.Value
        if (-not $imageDataUrl) {
            continue
        }

        @{
            id = $descriptor.cursorAppearanceId
            cursorKind = $descriptor.cursorKind
            imageDataUrl = $imageDataUrl
            hotspotRatioX = $descriptor.hotspotRatioX
            hotspotRatioY = $descriptor.hotspotRatioY
            referenceWidth = $descriptor.referenceWidth
            referenceHeight = $descriptor.referenceHeight
        }
    }

    [Console]::WriteLine(($catalog | ConvertTo-Json -Compress))
}

function Emit-ClickEvent([string]$button, [long]$startedAtMs, [bool]$ctrlKey) {
    $point = New-Object PointerInterop+POINT
    [void][PointerInterop]::GetCursorPos([ref]$point)
    $occurredAtMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

    $payload = @{
        type = 'click'
        button = $button
        x = $point.X
        y = $point.Y
        occurredAtMs = $occurredAtMs
        ctrlKey = $ctrlKey
        durationMs = if ($startedAtMs -gt 0) { [Math]::Max(0, $occurredAtMs - $startedAtMs) } else { 0 }
    } | ConvertTo-Json -Compress

    [Console]::WriteLine($payload)
}

if ($CatalogOnly) {
    Emit-CursorCatalog
    exit 0
}

while ($true) {
    $nextLeftDown = ([PointerInterop]::GetAsyncKeyState($vkLeft) -band 0x8000) -ne 0
    $nextRightDown = ([PointerInterop]::GetAsyncKeyState($vkRight) -band 0x8000) -ne 0
    $ctrlDown = ([PointerInterop]::GetAsyncKeyState($vkControl) -band 0x8000) -ne 0
    $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $cursorDescriptor = Get-CursorDescriptor
    $observedCursorKind = $cursorDescriptor.cursorKind
    $observedCursorAppearanceId = $cursorDescriptor.cursorAppearanceId
    $observedCursorImageDataUrl = $cursorDescriptor.cursorImageDataUrl
    $observedHotspotRatioX = $cursorDescriptor.hotspotRatioX
    $observedHotspotRatioY = $cursorDescriptor.hotspotRatioY
    $observedReferenceWidth = $cursorDescriptor.referenceWidth
    $observedReferenceHeight = $cursorDescriptor.referenceHeight

    if ($nextLeftDown -and -not $leftDown) {
        $leftStartedAtMs = $nowMs
        $leftCtrlKey = $ctrlDown
    }

    if ($nextRightDown -and -not $rightDown) {
        $rightStartedAtMs = $nowMs
        $rightCtrlKey = $ctrlDown
    }

    if (-not $nextLeftDown -and $leftDown) {
        Emit-ClickEvent 'left' $leftStartedAtMs $leftCtrlKey
        $leftStartedAtMs = 0
        $leftCtrlKey = $false
    }

    if (-not $nextRightDown -and $rightDown) {
        Emit-ClickEvent 'right' $rightStartedAtMs $rightCtrlKey
        $rightStartedAtMs = 0
        $rightCtrlKey = $false
    }

    $leftDown = $nextLeftDown
    $rightDown = $nextRightDown

    if ($observedCursorKind -ne $pendingCursorKind) {
        $pendingCursorKind = $observedCursorKind
        $pendingHotspotRatioX = $observedHotspotRatioX
        $pendingHotspotRatioY = $observedHotspotRatioY
        $pendingCursorAppearanceId = $observedCursorAppearanceId
        $pendingReferenceWidth = $observedReferenceWidth
        $pendingReferenceHeight = $observedReferenceHeight
        $pendingCursorSinceMs = $nowMs
    } elseif ($observedCursorAppearanceId -ne $pendingCursorAppearanceId) {
        $pendingCursorAppearanceId = $observedCursorAppearanceId
        $pendingHotspotRatioX = $observedHotspotRatioX
        $pendingHotspotRatioY = $observedHotspotRatioY
        $pendingReferenceWidth = $observedReferenceWidth
        $pendingReferenceHeight = $observedReferenceHeight
        $pendingCursorSinceMs = $nowMs
    } elseif (
        [Math]::Abs($observedHotspotRatioX - $pendingHotspotRatioX) -gt 0.0005 -or
        [Math]::Abs($observedHotspotRatioY - $pendingHotspotRatioY) -gt 0.0005 -or
        $observedReferenceWidth -ne $pendingReferenceWidth -or
        $observedReferenceHeight -ne $pendingReferenceHeight
    ) {
        $pendingHotspotRatioX = $observedHotspotRatioX
        $pendingHotspotRatioY = $observedHotspotRatioY
        $pendingReferenceWidth = $observedReferenceWidth
        $pendingReferenceHeight = $observedReferenceHeight
        $pendingCursorSinceMs = $nowMs
    } elseif (
        $pendingCursorKind -ne $emittedCursorKind -and
        ($pendingCursorSinceMs -eq 0 -or ($nowMs - $pendingCursorSinceMs) -ge 36)
    ) {
        $emittedCursorKind = $pendingCursorKind
        $emittedHotspotRatioX = $pendingHotspotRatioX
        $emittedHotspotRatioY = $pendingHotspotRatioY
        $emittedCursorAppearanceId = $pendingCursorAppearanceId
        $emittedReferenceWidth = $pendingReferenceWidth
        $emittedReferenceHeight = $pendingReferenceHeight
        Emit-CursorEvent $emittedCursorKind $emittedHotspotRatioX $emittedHotspotRatioY $emittedCursorAppearanceId $observedCursorImageDataUrl $emittedReferenceWidth $emittedReferenceHeight $nowMs
    } elseif (
        ($pendingCursorSinceMs -eq 0 -or ($nowMs - $pendingCursorSinceMs) -ge 36) -and
        (
            [Math]::Abs($pendingHotspotRatioX - $emittedHotspotRatioX) -gt 0.0005 -or
            [Math]::Abs($pendingHotspotRatioY - $emittedHotspotRatioY) -gt 0.0005 -or
            $pendingCursorAppearanceId -ne $emittedCursorAppearanceId -or
            $pendingReferenceWidth -ne $emittedReferenceWidth -or
            $pendingReferenceHeight -ne $emittedReferenceHeight
        )
    ) {
        $emittedHotspotRatioX = $pendingHotspotRatioX
        $emittedHotspotRatioY = $pendingHotspotRatioY
        $emittedCursorAppearanceId = $pendingCursorAppearanceId
        $emittedReferenceWidth = $pendingReferenceWidth
        $emittedReferenceHeight = $pendingReferenceHeight
        Emit-CursorEvent $emittedCursorKind $emittedHotspotRatioX $emittedHotspotRatioY $emittedCursorAppearanceId $observedCursorImageDataUrl $emittedReferenceWidth $emittedReferenceHeight $nowMs
    }

    Start-Sleep -Milliseconds 16
}
