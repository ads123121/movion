[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class KeyboardInterop {
    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);
}
"@

$modifierDefinitions = @(
    @{ Id = 'ctrl'; VirtualKeys = @(0x11) },
    @{ Id = 'shift'; VirtualKeys = @(0x10) },
    @{ Id = 'alt'; VirtualKeys = @(0x12) },
    @{ Id = 'meta'; VirtualKeys = @(0x5B, 0x5C) }
)

$keyDefinitions = @(
    @{ Id = 'tab'; VirtualKey = 0x09; Type = 'special' },
    @{ Id = 'enter'; VirtualKey = 0x0D; Type = 'special' },
    @{ Id = 'esc'; VirtualKey = 0x1B; Type = 'special' },
    @{ Id = 'space'; VirtualKey = 0x20; Type = 'special' },
    @{ Id = 'pageup'; VirtualKey = 0x21; Type = 'navigation' },
    @{ Id = 'pagedown'; VirtualKey = 0x22; Type = 'navigation' },
    @{ Id = 'end'; VirtualKey = 0x23; Type = 'navigation' },
    @{ Id = 'home'; VirtualKey = 0x24; Type = 'navigation' },
    @{ Id = 'left'; VirtualKey = 0x25; Type = 'navigation' },
    @{ Id = 'up'; VirtualKey = 0x26; Type = 'navigation' },
    @{ Id = 'right'; VirtualKey = 0x27; Type = 'navigation' },
    @{ Id = 'down'; VirtualKey = 0x28; Type = 'navigation' },
    @{ Id = 'insert'; VirtualKey = 0x2D; Type = 'special' },
    @{ Id = 'delete'; VirtualKey = 0x2E; Type = 'special' },
    @{ Id = 'backspace'; VirtualKey = 0x08; Type = 'special' }
)

foreach ($virtualKey in 0x70..0x7B) {
    $keyDefinitions += @{
        Id = "f$($virtualKey - 0x6F)"
        VirtualKey = $virtualKey
        Type = 'function'
    }
}

foreach ($virtualKey in 0x30..0x39) {
    $keyDefinitions += @{
        Id = [char]$virtualKey
        VirtualKey = $virtualKey
        Type = 'digit'
    }
}

foreach ($virtualKey in 0x41..0x5A) {
    $keyDefinitions += @{
        Id = ([char]$virtualKey).ToString().ToLowerInvariant()
        VirtualKey = $virtualKey
        Type = 'alpha'
    }
}

$trackedStates = @{}
$activeShortcuts = @{}

function Test-KeyDown([int[]]$virtualKeys) {
    foreach ($virtualKey in $virtualKeys) {
        if (([KeyboardInterop]::GetAsyncKeyState($virtualKey) -band 0x8000) -ne 0) {
            return $true
        }
    }

    return $false
}

function Get-ActiveModifiers() {
    $active = @()

    foreach ($definition in $modifierDefinitions) {
        if (Test-KeyDown $definition.VirtualKeys) {
            $active += $definition.Id
        }
    }

    return $active
}

function Should-CaptureShortcut([hashtable]$definition, [object[]]$modifiers) {
    if ($definition.Type -in @('special', 'navigation', 'function')) {
        return $true
    }

    return $modifiers.Count -gt 0
}

function Emit-ShortcutEvent([hashtable]$definition, [long]$startedAtMs, [object[]]$keys) {
    $occurredAtMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $payload = @{
        type = 'shortcut'
        keys = $keys
        occurredAtMs = $occurredAtMs
        durationMs = if ($startedAtMs -gt 0) { [Math]::Max(0, $occurredAtMs - $startedAtMs) } else { 0 }
    } | ConvertTo-Json -Compress

    [Console]::WriteLine($payload)
}

while ($true) {
    $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

    foreach ($definition in $keyDefinitions) {
        $isDown = Test-KeyDown @($definition.VirtualKey)
        $wasDown = [bool]$trackedStates[$definition.Id]

        if ($isDown -and -not $wasDown) {
            $modifiers = Get-ActiveModifiers

            if (Should-CaptureShortcut $definition $modifiers) {
                $activeShortcuts[$definition.Id] = @{
                    StartedAtMs = $nowMs
                    Keys = @($modifiers + $definition.Id)
                }
            }
        }

        if (-not $isDown -and $wasDown -and $activeShortcuts.ContainsKey($definition.Id)) {
            $activeShortcut = $activeShortcuts[$definition.Id]
            Emit-ShortcutEvent $definition $activeShortcut.StartedAtMs $activeShortcut.Keys
            $activeShortcuts.Remove($definition.Id)
        }

        $trackedStates[$definition.Id] = $isDown
    }

    Start-Sleep -Milliseconds 16
}
