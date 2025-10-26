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

⚠️ This plugin is unofficial and not affiliated with RainSoft.
Your credentials are sent only to the official RainSoft Remind API.

## Troubleshooting

Run Homebridge in debug mode to see polling logs:
```bash

homebridge -D
```
## License

MIT © 2025 Dustin Newell