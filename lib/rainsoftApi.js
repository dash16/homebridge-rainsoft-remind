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
	// ### 🧩 fetchDeviceSnapshot
	// High-level poll routine with token refresh fallback.
	//
	async fetchDeviceSnapshot(ctx) {
		// ctx: the accessory instance
		// We expect ctx to carry:
		//   ctx.email / ctx.password  (optional, for re-login)
		//   ctx.authToken             (may be stale)
		//   ctx.deviceId
		//   ctx.forceUpdate
	
		// helper to ensure we have a token, optionally refreshing using creds
		const ensureToken = async () => {
			if (ctx.authToken) {
				return true;
			}
			if (ctx.email && ctx.password) {
				this.log.info('[rainsoft-remind] No token, attempting login...');
				ctx.authToken = await this.login(ctx.email, ctx.password);
				if (!ctx.authToken) {
					this.log.warn('[rainsoft-remind] Login failed, cannot poll.');
					return false;
				}
				return true;
			}
			this.log.warn('[rainsoft-remind] Missing authToken and no credentials provided.');
			return false;
		};
	
		// 1. Make sure we have *some* token
		if (!ctx.deviceId) {
			this.log.warn('[rainsoft-remind] Missing deviceId; cannot poll.');
			return null;
		}
		if (!(await ensureToken())) {
			return null;
		}
	
		// 2. Optionally ask RainSoft to force-refresh device telemetry
		if (ctx.forceUpdate && ctx.authToken) {
			await this.forceUpdate(ctx.authToken);
		}
	
		// 3. Hit /device/:id
		let snapResp = await this.getDeviceStatus(ctx.authToken, ctx.deviceId);
	
		// 3a. If we got 400, assume token expired. Try re-login (if creds exist), then retry once.
		if (snapResp.status === 400) {
			if (ctx.email && ctx.password) {
				this.log.warn('[rainsoft-remind] Token rejected (400). Re-authenticating...');
				const newToken = await this.login(ctx.email, ctx.password);
				if (newToken) {
					ctx.authToken = newToken;
					snapResp = await this.getDeviceStatus(ctx.authToken, ctx.deviceId);
				} else {
					this.log.warn('[rainsoft-remind] Re-auth failed. Stale data.');
				}
			} else {
				this.log.warn('[rainsoft-remind] Token rejected (400) and no credentials available to refresh.');
			}
		}
	
		if (snapResp.status !== 200 || !snapResp.data) {
			this.log.warn(`[rainsoft-remind] getDeviceStatus(${ctx.deviceId}) failed HTTP ${snapResp.status}`);
			return null;
		}
	
		const data = snapResp.data;
	
		// 4. Parse → normalize for HomeKit
		const baseModel = (data.model || 'RainSoft').toString().trim();
		const sizePart = (data.unitSizeName || '').toString().trim();
		let resinPart = (data.resinTypeName || '').toString().trim();
		if (resinPart.toUpperCase().startsWith('TYPE')) {
			resinPart = resinPart.substring(4).trim();
		}
		const prettyModelParts = [baseModel, sizePart, resinPart].filter(Boolean);
		const prettyModel = prettyModelParts.join('-');
	
		const saltLbs = data.saltLbs;
		const maxSalt = data.maxSalt || 250;
		const capRemain = data.capacityRemaining;
		const statusName = data.systemStatusName || 'Unknown';
		const dispName = data.name || ctx.name;
		// Note: response doesn't actually include serialNumber,
		// so we fall back to what ctx already had.
		const serialGuess = data.serialNumber || ctx.serialNumber || ctx.deviceId;
	
		let saltPct = 0;
		if (typeof saltLbs === 'number' && typeof maxSalt === 'number' && maxSalt > 0) {
			saltPct = (saltLbs / maxSalt) * 100.0;
			if (saltPct < 0) saltPct = 0;
			if (saltPct > 100) saltPct = 100;
		}
	
		return {
			saltPct,
			capacityRemaining: (typeof capRemain === 'number') ? capRemain : 0,
			systemStatusName: statusName,
			prettyModel: prettyModel || baseModel,
			displayName: dispName,
			serialNumber: String(serialGuess),
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
