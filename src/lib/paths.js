import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..', '..');
export const dataDir = process.env.MF_DATA_DIR ?? path.join(root, 'data');
export const listingsPath = path.join(dataDir, 'listings.json');
export const itemsPath = path.join(dataDir, 'items.json');
export const auditPath = path.join(dataDir, 'audit.jsonl');
