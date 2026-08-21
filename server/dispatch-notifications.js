import "dotenv/config";
import { dispatchPendingWhatsApp } from "./notifications.js";
import { pool } from "./db.js";

try {
  const result = await dispatchPendingWhatsApp();
  console.log(`Processed ${result.length} WhatsApp notification(s).`);
} finally {
  await pool.end();
}
