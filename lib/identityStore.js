// lib/identityStore.js
const fs = require("fs");
const path = require("path");

function dir(storagePath) {
	const d = path.join(storagePath, "homebridge-rainsoft-remind");
	try { fs.mkdirSync(d, { recursive: true }); } catch {}
	return d;
}
function idFile(storagePath) { return path.join(dir(storagePath), "identity.json"); }
function statusFile(storagePath) { return path.join(dir(storagePath), "status.json"); }

// canonical on-disk shape
function blankIdentity() {
	return {
		deviceId:    null,
		name:        null,
		model:       null,
		serial:      null,
		firmware:    null,
		dealerName:  null,
		dealerPhone: null,
		dealerEmail: null,
	};
}
function normalizeIdentity(obj) {
	const base = blankIdentity();
	return {
		deviceId:    obj?.deviceId    ?? base.deviceId,
		name:        obj?.name        ?? base.name,
		model:       obj?.model       ?? base.model,
		serial:      obj?.serial      ?? base.serial,
		firmware:    obj?.firmware    ?? base.firmware,
		dealerName:  obj?.dealerName  ?? base.dealerName,
		dealerPhone: obj?.dealerPhone ?? base.dealerPhone,
		dealerEmail: obj?.dealerEmail ?? base.dealerEmail,
	};
}

function load(storagePath) {
	try {
		const p = idFile(storagePath);
		if (fs.existsSync(p)) {
			const raw = fs.readFileSync(p, "utf8");
			return normalizeIdentity(JSON.parse(raw || "{}"));
		}
	} catch {}
	return blankIdentity();
}

function save(storagePath, data) {
	try {
		const p = idFile(storagePath);
		const payload = normalizeIdentity(data || {});
		fs.writeFileSync(p, JSON.stringify(payload, null, 2), "utf8");
	} catch (e) { /* non-fatal */ }
}

// merge only defined keys into stored identity
function merge(storagePath, partial) {
	const cur = load(storagePath);
	const next = { ...cur };
	for (const k of Object.keys(partial || {})) {
		if (partial[k] !== undefined) next[k] = partial[k];
	}
	save(storagePath, next);
	return next;
}

// ---------- status (dynamic) ----------
function blankStatus() {
	return {
		lastRegenDate: null,   // ISO date string: "2025-11-15T00:00:00"
		nextRegenTime: null,   // ISO date/time:   "2025-11-16T02:00:00"
		asOf:          null,   // ISO timestamp of the snapshot
	};
}
function normalizeStatus(obj) {
	const base = blankStatus();
	return {
		lastRegenDate: obj?.lastRegenDate ?? base.lastRegenDate,
		nextRegenTime: obj?.nextRegenTime ?? base.nextRegenTime,
		asOf:          obj?.asOf          ?? base.asOf,
	};
}

function loadStatus(storagePath) {
	try {
		const p = statusFile(storagePath);
		if (fs.existsSync(p)) {
			const raw = fs.readFileSync(p, "utf8");
			return normalizeStatus(JSON.parse(raw || "{}"));
		}
	} catch {}
	return blankStatus();
}

function saveStatus(storagePath, data) {
	try {
		const p = statusFile(storagePath);
		const payload = normalizeStatus(data || {});
		fs.writeFileSync(p, JSON.stringify(payload, null, 2), "utf8");
	} catch (e) { /* non-fatal */ }
}

// merge only defined keys into stored status
function mergeStatus(storagePath, partial) {
	const cur = loadStatus(storagePath);
	const next = { ...cur };
	for (const k of Object.keys(partial || {})) {
		if (partial[k] !== undefined) next[k] = partial[k];
	}
	saveStatus(storagePath, next);
	return next;
}

module.exports = {
	load,
	save,
	merge,
	loadStatus,
	saveStatus,
	mergeStatus,
};