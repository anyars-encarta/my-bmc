import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

import * as schema from "./schema/index.js";

config({ path: resolve(fileURLToPath(new URL("../../.env", import.meta.url))) });

if (!process.env.DATABASE_URL) {
	throw new Error("DATABASE_URL is required");
}

const sql = neon(process.env.DATABASE_URL);

export const db = drizzle(sql, { schema });