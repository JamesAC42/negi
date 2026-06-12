import { getBackendConfig } from "../config.js";
import { SlskdService } from "../services/slskd-service.js";

const query = process.env.MUSIC_OS_SLSKD_INSPECT_QUERY?.trim();

if (!query) {
  throw new Error("Set MUSIC_OS_SLSKD_INSPECT_QUERY to part of a transfer filename or username");
}

const service = new SlskdService(getBackendConfig());
const records = await service.listTransferRecords();
const lowered = query.toLowerCase();
const filtered = records.filter((record) => JSON.stringify(record).toLowerCase().includes(lowered));
console.log(JSON.stringify({ query, matched: filtered.length, records: filtered.slice(0, 10) }, null, 2));
