import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "./db.js";

const [email, phone, password] = process.argv.slice(2);
if (!email || !phone || !password || password.length < 12) throw new Error("Usage: npm run seed:admin -- owner@example.com +919999999999 a-strong-password");
const hash = await bcrypt.hash(password, 12);
await pool.query("insert into users (email, phone, password_hash, role) values ($1,$2,$3,'admin') on conflict (email) do update set password_hash=excluded.password_hash, phone=excluded.phone", [email, phone, hash]);
console.log("Admin account created or updated.");
await pool.end();
