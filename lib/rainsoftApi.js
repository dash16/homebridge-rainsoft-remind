'use strict';

const axios = require('axios');

//
// ### 🧩 RainSoft API client: login, discovery, polling
// Centralizes all network I/O with remind.rainsoft.com
//

class RainsoftApi {
	constructor(log) {
		this.log = log;
		this.client = axios.create({
			baseURL: 'https://remind.rainsoft.com/api/remindapp/v2',
			headers: {
				'Accept': 'application/json',
				'Origin': 'ionic://localhost',
				'User-Agent': 'RainSoftRemind/Homebridge',
			},
			// we handle non-200s manually
			validateStatus: () => true
		});
	}

	//
	// ### 🧩 login: Exchange email/password for auth token
	// Returns authentication_token (string) or null on failure
	//
	async login(email, password) {
		try {
			const body = new URLSearchParams({ email, password }).toString();

			const res = await this.client.post('/login', body, {
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
			});

			if (res.status !== 200) {
				this.log.warn(`[rainsoft-remind] login failed: HTTP ${res.status}`);
				return null;
			}

			if (res.data && res.data.authentication_token) {
				return res.data.authentication_token;
			} else {
				this.log.warn('[rainsoft-remind] login response missing authentication_token');
				return null;
			}
		} catch (err) {
			this._logAxiosError('login exception', err);
			return null;
		}
	}

	//
	// ### 🧩 discoverAccount: end-to-end bootstrap
	// Reason: First-time setup. Takes email+password, returns {
	//   authToken,
	//   customerId,
	//   locationId,
	//   locationName,
	//   deviceId,
	//   deviceName,
	//   prettyModel bits,
	//   snapshot of status fields (saltLbs, capacityRemaining, etc.)
	// }
	//
	async discoverAccount(email, password) {
		// 1. Login -> get authToken
		const authToken = await this.login(email, password);
		if (!authToken) {
			this.log.warn('[rainsoft-remind] discoverAccount: login failed');
			return null;
		}
	
		// Headers we’ll reuse for authenticated GETs
		const authHeaders = {
			'X-Remind-Auth-Token': authToken,
			'Accept': 'application/json',
			'Origin': 'ionic://localhost',
			'User-Agent': 'RainSoftRemind/Homebridge',
		};
	
		// 2. GET /customer -> gives us the "account id"
		const customerResp = await this.client.get('/customer', {
			headers: authHeaders
		});
	
		if (customerResp.status !== 200 || !customerResp.data || !customerResp.data.id) {
			this.log.warn(`[rainsoft-remind] discoverAccount: /customer failed HTTP ${customerResp.status}`);
			return null;
		}
		const customerId = customerResp.data.id;
	
		// 3. GET /locations/{customerId} -> list of locations + devices
		const locResp = await this.client.get(`/locations/${customerId}`, {
			headers: authHeaders
		});
	
		if (locResp.status !== 200 || !locResp.data || !Array.isArray(locResp.data.locationListData)) {
			this.log.warn(`[rainsoft-remind] discoverAccount: /locations/${customerId} failed HTTP ${locResp.status}`);
			return null;
		}
	
		const firstLoc = locResp.data.locationListData[0];
		if (!firstLoc) {
			this.log.warn('[rainsoft-remind] discoverAccount: no locations found');
			return null;
		}
	
		const locationId = firstLoc.id;
		const locationName = firstLoc.name;
	
		if (!Array.isArray(firstLoc.devices) || firstLoc.devices.length === 0) {
			this.log.warn('[rainsoft-remind] discoverAccount: no devices found in first location');
			return null;
		}
	
		const device = firstLoc.devices[0];
		const deviceId = device.id;
	
		// Build a nice model label
		const baseModel = (device.model || 'RainSoft').toString().trim();
		const sizePart = (device.unitSizeName || '').toString().trim();
		let resinPart = (device.resinTypeName || '').toString().trim();
		if (resinPart.toUpperCase().startsWith('TYPE')) {
			resinPart = resinPart.substring(4).trim();
		}
		const prettyModelParts = [baseModel, sizePart, resinPart].filter(Boolean);
		const prettyModel = prettyModelParts.join('-');
	
		return {
			authToken,
			customerId,
			locationId,
			locationName,
			deviceId,
			deviceName: device.name || device.model || 'RainSoft',
			prettyModel,
			serialNumber: device.serialNumber
				? String(device.serialNumber)
				: (deviceId ? String(deviceId) : "Unknown"),
			status: {
				systemStatusCode: device.systemStatusCode,
				systemStatusName: device.systemStatusName,
				capacityRemaining: device.capacityRemaining,
				saltLbs: device.saltLbs,
				maxSalt: device.maxSalt,
				isVacationMode: device.isVacationMode,
				regenTime: device.regenTime,
				serialNumber: device.serialNumber,
			},
		};
	}
	
	// NOTE LEGACY: getLocations() calls /locations/ with no customerId.
	// We now use discoverAccount() which calls /customer then /locations/{customerId}.
	// Once discoverAccount() is in use everywhere, this can be removed.
	//
	// ### 🧩 getLocations: returns the full /locations payload for this account
	//
	async getLocations(token) {
		try {
			const resp = await this.client.get('/locations/', {
				headers: {
					'X-Remind-Auth-Token': token,
				}
			});

			if (resp.status !== 200) {
				this.log(`[rainsoft-remind] getLocations failed: HTTP ${resp.status}`);
				return null;
			}

			return resp.data;
		} catch (err) {
			this._logAxiosError('getLocations exception', err);
			return null;
		}
	}

	//
	// ### 🧩 forceUpdate: tells RainSoft cloud "ask the unit for fresh data"
	// Returns true on 200, false otherwise.
	//
	async forceUpdate(token) {
		try {
			const resp = await this.client.get('/forceupdate', {
				headers: {
					'X-Remind-Auth-Token': token,
				}
			});

			if (resp.status !== 200) {
				this.log.warn(`[rainsoft-remind] forceUpdate failed HTTP ${resp.status}`);
				return false;
			}

			return true;
		} catch (err) {
			this._logAxiosError('forceUpdate exception', err);
			return false;
		}
	}

	//
	// ### 🧩 getDeviceStatus: call /device/:id with the current token
	// Returns { status, data }.
	//
	async getDeviceStatus(token, deviceId) {
		try {
			const resp = await this.client.get(`/device/${deviceId}`, {
				headers: {
					'X-Remind-Auth-Token': token,
					'Content-Type': 'application/x-www-form-urlencoded',
				}
			});
	
			// Always hand the caller both status and data. We won't decide here.
			return {
				status: resp.status,
				data: resp.data || null
			};
		} catch (err) {
			this._logAxiosError('getDeviceStatus exception', err);
			return {
				status: 0,
				data: null
			};
		}
	}

	//
	// ### 🧩 fetchDeviceSnapshot: pull latest cloud view of the softener
	// Reason: Used by the accessory poll loop. Optionally trigger a forceUpdate
	//         on demand (manual refresh) without doing that every interval.
	//
	// ctx: the accessory (we read ctx.email, ctx.password, ctx.deviceId, ctx.authToken, ctx.forceUpdate)
	// opts.force: boolean, if true we call forceUpdate() before reading status
	//
	async fetchDeviceSnapshot(ctx, opts = {}) {
		const wantForce = opts.force === true;
	
		// 1. make sure we have a valid token
		let token = ctx.authToken;
		if (!token && ctx.email && ctx.password) {
			// no token yet? login now
			token = await this.login(ctx.email, ctx.password);
			ctx.authToken = token;
		}
	
		if (!token) {
			this.log.warn("[rainsoft-remind] fetchDeviceSnapshot: no auth token available.");
			return null;
		}
	
		// 2. optionally force-refresh the device in RainSoft cloud
		//    (we only do this if the caller *explicitly* asked for it)
		if (wantForce && ctx.forceUpdate) {
			try {
				await this.forceUpdate(token);
			} catch (err) {
				this.log.debug("[rainsoft-remind] forceUpdate failed (non-fatal): " + err);
			}
		}
	
		// 3. grab current device status snapshot
		let respObj;
		try {
			respObj = await this.getDeviceStatus(token, ctx.deviceId);
		} catch (err) {
			// if the token is stale (RainSoft kicked it), try re-login once
			if (err.response && err.response.status === 400 && ctx.email && ctx.password) {
				this.log.warn("[rainsoft-remind] token likely expired, reauthenticating...");
				token = await this.login(ctx.email, ctx.password);
				ctx.authToken = token;
		
				respObj = await this.getDeviceStatus(token, ctx.deviceId);
			} else {
				this.log.warn("[rainsoft-remind] getDeviceStatus failed: " + err);
				return null;
			}
		}
		
		if (!respObj) {
			this.log.warn("[rainsoft-remind] getDeviceStatus returned no data.");
			return null;
		}
		
		// unwrap the actual body
		if (respObj.status !== 200 || !respObj.data) {
			this.log.warn(`[rainsoft-remind] getDeviceStatus bad HTTP ${respObj.status}`);
			return null;
		}
		
		const data = respObj.data;
	
		// RainSoft response shape (example):
		// {
		//   "name": "EC5",
		//   "model": "EC5",
		//   "systemStatusName": "Normal",
		//   "saltLbs": 224,
		//   "maxSalt": 250,
		//   "capacityRemaining": 77,
		//   "unitSizeName": "75",
		//   "resinTypeName": "TYPE CV",
		//   "serialNumber": 1234567,
		//   ...
		// }
	
		// Compute salt percentage safely
		let saltPct = 0;
		if (typeof data.saltLbs === "number" && typeof data.maxSalt === "number" && data.maxSalt > 0) {
			saltPct = (data.saltLbs / data.maxSalt) * 100;
			if (saltPct > 100) saltPct = 100;
			if (saltPct < 0) saltPct = 0;
		}
	
		// Build prettyModel (same logic we use at discovery)
		const baseModel = (data.model || "RainSoft").toString().trim();
		const sizePart = (data.unitSizeName || "").toString().trim();
		let resinPart = (data.resinTypeName || "").toString().trim();
		if (resinPart.toUpperCase().startsWith("TYPE")) {
			resinPart = resinPart.substring(4).trim();
		}
		const prettyParts = [baseModel, sizePart, resinPart].filter(Boolean);
		const prettyModel = prettyParts.join("-");
	
		const serialNumber = data.serialNumber
			? String(data.serialNumber)
			: (ctx.deviceId ? String(ctx.deviceId) : "Unknown");
	
		return {
			displayName: data.name || data.model || "RainSoft",
			serialNumber,
			prettyModel,
			systemStatusName: data.systemStatusName || "Unknown",
			capacityRemaining: (typeof data.capacityRemaining === "number") ? data.capacityRemaining : 0,
	
			// normalized battery-like metric for salt
			saltPct,
		};
	}


	_logAxiosError(prefix, err) {
		if (err.response) {
			this.log.error(`[rainsoft-remind] ${prefix}: HTTP ${err.response.status}`);
		} else if (err.request) {
			this.log.error(`[rainsoft-remind] ${prefix}: no response from server`);
		} else {
			this.log.error(`[rainsoft-remind] ${prefix}: ${err.message}`);
		}
	}
}

module.exports = RainsoftApi;
