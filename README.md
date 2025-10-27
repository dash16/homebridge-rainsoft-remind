<p align="center">
  <img src="./homebridge-ui/public/icon.png" width="180" height="180" alt="homebridge-rainsoft-remind icon">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/homebridge-rainsoft-remind"><img src="https://img.shields.io/npm/v/homebridge-rainsoft-remind.svg?color=cb3837&logo=npm" alt="npm version"></a>
  <a href="https://github.com/dash16/homebridge-rainsoft-remind/stargazers"><img src="https://img.shields.io/github/stars/dash16/homebridge-rainsoft-remind.svg?style=flat&color=ffcc00" alt="GitHub stars"></a>
  <a href="https://github.com/dash16/homebridge-rainsoft-remind/issues"><img src="https://img.shields.io/github/issues/dash16/homebridge-rainsoft-remind.svg?color=yellow" alt="GitHub issues"></a>
  <a href="https://github.com/dash16/homebridge-rainsoft-remind/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License"></a>
</p>

<h1 align="center">homebridge-rainsoft-remind</h1>
<p align="center"> 🌧️ Homebridge plugin for RainSoft EC5 water softeners using data from the RainSoft Remind cloud.</p>



## Features
- Reports **salt level** as a Battery Level sensor  
- Reports **system status** (normal / needs attention) as a Contact Sensor  
- Reports **remaining capacity** as a Humidity Sensor  
- Configurable polling interval and “force update” option

## Installation
1. In Homebridge UI, go to **Plugins → Search**  
2. Search for **homebridge-rainsoft-remind**  
3. Click **Install**

Or via CLI:
```bash
sudo npm install -g homebridge-rainsoft-remind
```

### How to Obtain Your Device ID and Auth Token

> ⚠️ These values come from your **RainSoft Remind** mobile app and are required for the plugin to connect.  
> You only need to collect them once. Keep them private.

#### Using a Network Proxy (Charles Proxy or similar)
1. Install **Charles Proxy** (macOS) or **HTTP Toolkit** (Windows/Linux).
2. Enable HTTPS proxying and connect your phone or tablet to the same Wi-Fi network.
3. Open the **RainSoft Remind** app and refresh the *System Info* screen.
4. In Charles, look for a request like:
   `https://api.rainsoftremind.com/device/123456/status`
   - The `123456` part of that URL is your **Device ID**.
5. In that same request, look under **Headers** for:
   `X-Remind-Auth-Token: abcd1234-example-token-5678`
   - That long string is your **Auth Token**.
6. Copy those two values into the Homebridge plugin configuration fields.

### Security Notes
⚠️ **This plugin is unofficial and not affiliated with RainSoft.**

- Your Auth Token allows access to your RainSoft Remind account data.
- The token is stored only in your local Homebridge config and is sent only to the official RainSoft Remind API.
- Do **not** share screenshots of your Homebridge config screen publicly.

## Configuration

After installing, open the plugin’s Settings page in Homebridge UI.

| Field                | Description                                 |
| -------------------- | ------------------------------------------- |
| **Name**             | How it appears in Home                      |
| **Model Label**      | From RainSoft Remind → System Info → Model  |
| **Device ID**        | Numeric ID from the RainSoft API URL        |
| **Serial Number**    | From RainSoft Remind → System Info → Serial |
| **Email**    		   | Username used in RainSoft Remind to log in  |
| **Password**    	   | Password used in RainSoft Remind to log in  |
| **Auth Token**       | Value of `X-Remind-Auth-Token` header       |
| **Polling Interval** | How often to refresh (default 300 s)        |
| **Force Update**     | Request latest readings before each poll    |

You now have two ways to configure the plugin:

### Option A: Automatic (Recommended)

Let the plugin talk to your RainSoft Remind account and pull device info for you.

1. In Homebridge UI:

   * Go to **Plugins → homebridge-rainsoft-remind → Settings**
   * Enter:

     * RainSoft Email
     * RainSoft Password

2. Save and restart Homebridge.

What this does:

* The plugin will log in to the RainSoft Remind API using axios.
* It will request your device / location info (model, serial, etc.).
* Those details are then used to expose your softener to HomeKit.

Why this is nice:

* No packet sniffing.
* No manual serial scraping.

Security note:

* Your RainSoft email + password are stored in `config.json` the same way other Homebridge plugins store credentials.
* We do NOT send your credentials anywhere except directly to the RainSoft Remind API.
* We do NOT expose your credentials to HomeKit.

### Option B: Manual (No credentials stored)

If you don't want to save your RainSoft login:

1. In the Remind mobile app, note:

   * Device serial number
   * Model / product name
   * (Any other IDs the plugin asks for in the UI)

2. In Homebridge UI, leave the email/password blank and instead fill in the device info fields manually.

3. Save and restart Homebridge.

This behaves like v0.1.x.

---

### What gets created in HomeKit?

Right now we expose the softener as a sensor-style accessory so you can view status in Home and in automations. More rich characteristics (salt level alerts, flow info, etc.) will land in future versions.

---

### Troubleshooting / FAQ

**Q: My token seems to expire and I get "Not authorized."**
A: That's expected. Tokens from the RainSoft API aren't permanent. v0.2.0 will attempt to log in with your email/password again to get a fresh token on restart. Seamless background refresh is planned for a future version.

**Q: I don't see any accessories after I restart.**
A: Double-check either:

* Your RainSoft login is correct, OR
* Your manual model/serial info is filled in.

Then restart Homebridge and wait for the accessory to show up.

Run Homebridge in debug mode to see polling logs:
```bash
homebridge -D
```
## License

MIT © 2025 Dustin Newell