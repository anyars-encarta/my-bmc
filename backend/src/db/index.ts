import "dotenv/config";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

import * as schema from "./schema/index.js";

if (!process.env.DATABASE_URL) {
	throw new Error("DATABASE_URL is required");
}

const sql = neon(process.env.DATABASE_URL);

export const db = drizzle(sql, { schema });