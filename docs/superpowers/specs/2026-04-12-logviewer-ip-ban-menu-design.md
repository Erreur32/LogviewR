# LogViewer IP Context Menu + Ban fail2ban Modal

**Date:** 2026-04-12
**Status:** Approved

## Goal

Add a context menu on IP cells in the LogViewer log table with two actions:
1. "Exclure des logs" (existing functionality)
2. "Bannir avec fail2ban" (new — opens a ban modal)

Also display a shield icon next to IPs that are currently banned in any fail2ban jail.

## Design

### 1. IP Context Menu (IpContextMenu.tsx)

- **Trigger:** Left-click on any IP cell in LogTable (replaces current direct `onAddIpToFilter` click)
- **Position:** Portal, anchored below the clicked IP cell
- **Closes on:** click outside, Escape key, or action selection
- **Two options:**
  - `ShieldOff` icon + "Exclure des logs" → calls existing `onAddIpToFilter`
  - `ShieldAlert` icon + "Bannir avec fail2ban" → opens BanIpModal
    - Greyed out with tooltip if fail2ban plugin is disabled/unavailable
- **Style:** Inline styles, fail2ban PHP palette (bg1=#161b22, border=#30363d, text=#e6edf3)

### 2. Ban Modal (BanIpModal.tsx)

- **Style:** Inline styles, fail2ban PHP palette (card/cardH/cardB pattern)
- **Content:**
  - Header: "Bannir une IP avec fail2ban"
  - IP displayed in mono #e6edf3
  - Dropdown of active jails (fetched from `GET /api/plugins/fail2ban/status?days=1`)
  - Warning if IP already banned in a jail (orange #e3b341)
  - Cancel + Ban buttons
- **On ban:** `POST /api/plugins/fail2ban/ban` with `{ jail, ip }`
- **Success:** Toast via notificationStore, close modal
- **Error:** Inline error message in modal (red)
- **Overlay:** Semi-transparent backdrop, click outside closes

### 3. Banned IP Indicator in LogTable

- **Icon:** Lucide `ShieldAlert`, 12px, color #e86a65 (red) next to IP text
- **Tooltip:** "Bannie dans : sshd, recidive" (list of jails)
- **Data source:** `bannedIpsMap: Map<string, string[]>` prop passed from LogViewerPage
- **Built from:** Aggregating `bannedIps[]` from all jails in the fail2ban status response

### 4. Data Flow

```
LogViewerPage (mount)
  → fetch /api/plugins/fail2ban/status?days=1
  → build bannedIpsMap: Map<ip, jail[]>
  → pass to LogTable as prop

LogTable (IP cell click)
  → open IpContextMenu at click position
    → "Exclure" → onAddIpToFilter(ip)  [existing]
    → "Bannir"  → onBanIp(ip)          [new]

LogViewerPage
  → banIpTarget state → opens BanIpModal
  → BanIpModal fetches jails, user picks jail
  → POST /api/plugins/fail2ban/ban { jail, ip }
  → success → toast + close + refresh bannedIpsMap
```

### 5. Files

| File | Action |
|------|--------|
| `src/components/log-viewer/IpContextMenu.tsx` | Create — dropdown menu component |
| `src/components/log-viewer/BanIpModal.tsx` | Create — ban modal (inline PHP style) |
| `src/components/log-viewer/LogTable.tsx` | Modify — IP click opens context menu, show shield icon |
| `src/pages/LogViewerPage.tsx` | Modify — fetch banned IPs, manage modal state |
| `src/locales/en.json` | Modify — add i18n keys |
| `src/locales/fr.json` | Modify — add i18n keys |

### 6. Props

```typescript
// IpContextMenu
interface IpContextMenuProps {
  ip: string;
  x: number;
  y: number;
  onExclude: (ip: string) => void;
  onBan: (ip: string) => void;
  fail2banAvailable: boolean;
  onClose: () => void;
}

// BanIpModal
interface BanIpModalProps {
  ip: string;
  onClose: () => void;
  onBanned: (jail: string, ip: string) => void;
}

// LogTable additions
interface LogTableProps {
  // ... existing props
  bannedIpsMap?: Map<string, string[]>;
  onBanIp?: (ip: string) => void;
}
```

### 7. API Endpoints Used

- `GET /api/plugins/fail2ban/status?days=1` — jail list + bannedIps per jail
- `POST /api/plugins/fail2ban/ban` — `{ jail: string, ip: string }`

### 8. i18n Keys

```
logViewer.ipMenu.exclude = "Exclure des logs" / "Exclude from logs"
logViewer.ipMenu.ban = "Bannir avec fail2ban" / "Ban with fail2ban"
logViewer.ipMenu.banUnavailable = "fail2ban non disponible" / "fail2ban unavailable"
logViewer.banModal.title = "Bannir une IP" / "Ban an IP"
logViewer.banModal.selectJail = "Choisir un jail" / "Select a jail"
logViewer.banModal.alreadyBanned = "Déjà bannie dans : {{jails}}" / "Already banned in: {{jails}}"
logViewer.banModal.ban = "Bannir" / "Ban"
logViewer.banModal.cancel = "Annuler" / "Cancel"
logViewer.banModal.success = "{{ip}} bannie dans {{jail}}" / "{{ip}} banned in {{jail}}"
logViewer.banModal.error = "Erreur : {{error}}" / "Error: {{error}}"
logViewer.bannedTooltip = "Bannie dans : {{jails}}" / "Banned in: {{jails}}"
```
