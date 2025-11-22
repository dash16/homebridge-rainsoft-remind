## v0.4.5 – Cached Contact Cleanup
**Release Date:** 2025-11-21

### Fixed
- Resolved a startup crash caused by attempting to add a duplicate `ContactSensor` service with subtype `status` when restoring cached accessories.
  - The `Status` service is now created idempotently using `getServiceById(..., 'status')` before falling back to `addService(...)`.
  - Existing cached accessories will now restore cleanly without throwing `Cannot add a Service with the same UUID ... and subtype 'status'` errors.

### Notes
- No new features or breaking changes. This is a targeted stability patch on top of v0.4.4.

# v0.4.4 — Name Tags
**Release Date:** 2025-11-15

### Highlights
- Friendly service names now show in Home (and in Homebridge UI):
  - **Capacity Remaining** (HumiditySensor)
  - **Regeneration** (Occupancy/Contact sensor in your build)
  - **Status** (accessory information summary)
- Serial number fallback remains DeviceID if a true serial is not available (to be refined later).

### Fixes
- Safer default values for Accessory Information to avoid undefined reads during boot.
- Small internal cleanups for snapshot handling/log messages.

---

# v0.4.3 — Dealer Drop (npm only)
**Release Date:** 2025-11-14

### Highlights
- `identity.json` now **persists dealer information** (name, email, phone) captured from the device API.
- Identity store write path hardened; file is created when missing and updated on login/poll as needed.

### Fixes
- Reduced noisy logs while restoring the cached accessory.
- Minor resilience improvements if the RainSoft service returns partial data.

---

# v0.4.2 — One Accessory, One Timer (npm only)
**Release Date:** 2025-11-10

### Highlights
- **Single accessory** registration and restoration (eliminates the “triplicated accessories” issue).
- Platform-level **single polling timer** with an ensure-once guard (no duplicate pollers).
- TypeScript/HAP typing alignment to unblock builds.
- More defensive defaults for first-run initialization (no identity yet).

### Fixes
- Compile error around non-existent `HAP.Service.BatteryService` resolved.
- Better handling when `deviceId` is missing; clearer assert and early return.
- Safer platform bootstrap and improved error messages around HTTP 400/0 cases.
---

## v0.4.1 — Schema-only reset
**Release Date:** 2025-11-10

- Rolled back from experimental custom UI introduced in v0.4.0
- Removed `@homebridge/plugin-ui-utils` dependency and all UI server code
- Restored clean, schema-driven configuration (`config.schema.json`)
- Simplified config: removed read-only dealer and firmware fields
- Retained both login (email + password) and manual (authToken + deviceId) authentication paths
- Preserved plugin icon in `homebridge-ui/public/` for eventual custom UI return
- Bumped package.json to 0.4.1 and published to npm / GitHub for stable release tracking

## v0.4.0 — Experimental custom UI release (npm only)
**Release Date:** 2025-11-07

- Introduced experimental **Homebridge Custom UI** powered by `@homebridge/plugin-ui-utils`
- Added `/homebridge-ui/server.js` to handle `/login` and `/identity` API calls from the web UI
- Added HTML-based interface at `/homebridge-ui/public/index.html`
- Automatically discovered RainSoft system identity (model, serial, firmware, dealer info)
- Updated `config.schema.json` with `"customUi": true` and custom button action handler
- Shipped to **npm** but not published to **GitHub**; later deprecated due to UI runtime issues

## v0.3.1 — “Platform, Meet Accessory”
**Release Date:** 2025-10-30

### 🧩 Summary
This stabilization patch converts the plugin from a mis-declared *platform* into a properly registered *accessory*, resolving child-bridge startup failures and blank Home.app behavior after v0.3.0.  
It also removes EC5-specific naming and clarifies configuration schema alignment.

### ✨ Changes
- ✅ Fixed **plugin type mismatch** (`platform` → `accessory`) to restore pairing and child-bridge reliability.
- ✅ Standardized `pluginAlias` → `RainsoftRemind` (consistent casing with `index.js`).
- ✅ Updated default accessory name and model label to generic *RainSoft System*.
- ✅ Cleaned up logging and UI schema wording.
- ✅ Clarified `README.md` instructions to reflect accessory configuration.
- ✅ Bumped version to **0.3.1** and polished package metadata (keywords, description).

### 🧰 Developer Notes
- Re-add the plugin as an *accessory* (not a platform) in Homebridge UI.
- If a broken child bridge exists from 0.3.0, remove it and restart Homebridge.
- Future versions will build on this as the **stable baseline** for new features.

---

# v0.3.0 — Autodiscovery
**Release Date:** 2025-10-27

### ✨ New Features
- **Automatic Login & Discovery** – The plugin now authenticates directly with the RainSoft Remind API using your email and password. No more manual tokens or Charles Proxy snooping required.
- **Device ID Resolution** – Automatically finds your connected EC5 system and links it to HomeKit.  
	- Read-only Fields – Detects model, serial, and device ID and displays in the UI but protected from editing.
	- Simplified Configuration – Only email, password, and (optionally) polling interval are needed in your Homebridge config.
- **Live Polling** – Retrieves fresh device data on a configurable schedule. Defaults to a safe 30-minute interval to reduce API load.

### ⚙️ Improvements
- Refactored discovery logic into modular helper functions.
- Better handling of API timeouts and token refreshes.
- **New Homebridge UI schema** – The plugin is now recognized as a platform, with a clear, modern configuration layout.

### 🧹 Internal
- **Power User Mode** – Added a collapsible “Power Users / Manual Setup” section that allows specifying authToken and deviceId manually for advanced or offline setups.
- Removed legacy token and manual device ID fields.
- Streamlined `index.js` and `RainsoftAPI.js` for maintainability.
- Updated README with new setup instructions and visuals.
- Removed Herobrine.

---
## 0.2.2 - Cleanup
**Release Date:** 2025-10-27
- updated package.json to coerce homebridge into actually using my icon
- added npm install scripts

## 0.2.1 - Iconic
**Release Date:** 2025-10-27
- Added project icon
- Added badges on Readme

## 0.2.0 - Email login
**Release Date:** 2025-10-27
- Support for logging in using email address and password to obtain a token automatically
- Cleaned up schema for config

## 0.1.3 - Dependancies
**Release Date:** 2025-10-26
- Adding axios as a dependency in order to support new library for username/password login to Rainsoft cloud

## 0.1.2 - Bug fixes
**Release Date:** 2025-10-26
- Minor code cleanup
- Preemptive change to error reporting to avoid catching auth keys (~~```body=${raw}```~~)

## 0.1.1 - Sanitized
**Release Date:** 2025-10-26
- Replaced real-world example values with generic examples in README, config.schema.json, and docs.
- Added instructions for obtaining Device ID and Auth Token.

## 0.1.0 – Initial Release  
**Release Date:** 2025-10-26
- First public version
- Adds salt, status, and capacity sensors
- Adds polling / force update logic.
