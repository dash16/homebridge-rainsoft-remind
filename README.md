# homebridge-rainsoft-remind

> 🌧️ Homebridge plugin for RainSoft EC5 water softeners using data from the RainSoft Remind cloud.

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
| **Serial Number**    | From RainSoft Remind → System Info → Serial |
| **Device ID**        | Numeric ID from the RainSoft API URL        |
| **Auth Token**       | Value of `X-Remind-Auth-Token` header       |
| **Polling Interval** | How often to refresh (default 300 s)        |
| **Force Update**     | Request latest readings before each poll    |

## Troubleshooting

Run Homebridge in debug mode to see polling logs:
```bash
homebridge -D
```
## License

MIT © 2025 Dustin Newell