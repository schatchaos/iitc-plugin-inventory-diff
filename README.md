# IITC Plugin: Inventory Diff

An [IITC](https://iitc.app/) plugin for [Ingress](https://ingress.com/) that captures inventory snapshots and shows what changed between them.

**[https://github.com/schatchaos/iitc-plugin-inventory-diff](https://github.com/schatchaos/iitc-plugin-inventory-diff)**

## Features

- **Snapshot inventory** at any point in time
- **Compare two snapshots** to see exactly what was gained or lost
- **Categorised inventory view** — click any snapshot date to browse your full inventory organised by category
- **Key locker awareness** — keys in KEY_CAPSULEs are tracked separately and excluded from the 2500-item capacity count, matching the in-game display
- **Rate limit protection** — warns you if your last snapshot is less than 5 minutes old
- Up to 50 snapshots stored in `localStorage`

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) for Chrome/Firefox
2. Install [IITC](https://iitc.app/)
3. Open Tampermonkey → Dashboard → **+** (new script)
4. Paste the contents of `inventory-diff.user.js` and save

## Usage

### Taking snapshots

Click **Inventory Diff** in the IITC toolbox. Hit **Take Snapshot** to fetch and store your current inventory.

### Viewing inventory

Click any snapshot **date** to open a categorised inventory popup. Categories can be expanded/collapsed individually. Multiple popups can be open side by side for visual comparison.

Categories: Boosts · Capsules · Resonators · Weapons · Cubes · Mods · Other

### Comparing snapshots

Select snapshot **A** (earlier) and **B** (later) using the radio buttons, then click **Show Diff (A → B)**.

- Green = gained
- Red = lost / used

Enable **per-portal key detail** to see individual portal key changes instead of just the total.

The plugin automatically sorts A and B by timestamp, so the direction is always earlier → later regardless of which radio button you pick.

## Inventory columns

| Column | Description |
|---|---|
| Items | Non-key items (excludes keys and entitlements) |
| Keys | Portal keys in your main inventory (counts toward 2500 limit) |
| Total | Items + Keys (matches the in-game capacity counter) |
| (Lockers) | Keys stored in KEY_CAPSULEs — do not count toward the 2500 limit |

## Item categories

| Category | Item types |
|---|---|
| Weapons | XMP Bursters, Ultrastrikes, ADA Refactors, Jarvis Viruses |
| Resonators | Resonators (all levels) |
| Mods | Portal Shields, Aegis Shields, Turrets, Force Amps, Heat Sinks, Multi-hacks, Link Amps, Softbank Ultra Links, ITO EN Transmuters |
| Cubes | Power Cubes, Hypercubes |
| Capsules | Capsules, Key Capsules, Kinetic Capsules, Quantum Capsules |
| Boosts | Frackers, APEX, Fireworks, Beacons, Battle Beacons |

## Notes

- Inventory data is fetched directly from the Ingress API via `getInventory`
- Fetching too frequently may trigger a rate limit — the plugin warns you if your last snapshot is under 5 minutes old
- Snapshots are stored in `localStorage` under the key `plugin-inventory-diff-snapshots`
- A maximum of 50 snapshots are retained; oldest are dropped automatically

## Acknowledgements

Inventory parsing approach inspired by [iitc-inventory-parser](https://github.com/633KYN35D/iitc-inventory-parser) by 633KYN35D and EisFrei.

## Screenshot

Chrome desktop + Tampermonkey

<img width="1057" height="554" alt="image" src="https://github.com/user-attachments/assets/aaf83fca-42b0-4127-a917-556604f1624d" />
