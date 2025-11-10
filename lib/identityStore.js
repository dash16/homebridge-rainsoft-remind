
const fs = require("fs");
const path = require("path");

function dir(storagePath) {
	const d = path.join(storagePath, "homebridge-rainsoft-remind");
	try { fs.mkdirSync(d, { recursive: true }); } catch {}
	return d;
}

function file(storagePath) {
	return path.join(dir(storagePath), "identity.json");
}

function load(storagePath) {
	try {
		const p = file(storagePath);
		if (fs.existsSync(p)) {
			const raw = fs.readFileSync(p, "utf8");
			const obj = JSON.parse(raw || "{}");
			return {
				name: obj.name || null,
				model: obj.model || null,
				serial: obj.serial || null,
				firmware: obj.firmware || null,
				dealerName: obj.dealerName || null,
				dealerPhone: obj.dealerPhone || null,
				dealerEmail: obj.dealerEmail || null			};
		}
	} catch {}
	return {
			name: null,
			model: null,
			serial: null,
			firmware: null,
			dealerName: null,
			dealerPhone: null,
			dealerEmail: null
		};
}

function save(storagePath, data) {
	try {
		const p = file(storagePath);
		const payload = {
			name: data.name ?? null,
			model: data.model ?? null,
			serial: data.serial ?? null,
			firmware: data.firmware ?? null,
			dealerName: data.dealerName ?? null,
			dealerPhone: data.dealerPhone ?? null,
			dealerEmail: data.dealerEmail ?? null
		};
		fs.writeFileSync(p, JSON.stringify(payload, null, 2), "utf8");
	} catch (e) {
		// non-fatal
	}
}

module.exports = { load, save };
