import fs from 'node:fs';
import { auditPath } from './paths.js';

/** Append-only event log. Never holds page content or anything personal. */
export const audit = (action, fields = {}) => {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), action, ...fields });
  fs.appendFileSync(auditPath, `${line}\n`, { mode: 0o600 });
};
