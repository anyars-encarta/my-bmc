import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required in .env for Drizzle migrations");
}

const dbUrl = new URL(process.env.DATABASE_URL);

export default defineConfig({
  schema: ["./src/db/schema/app.ts", "./src/db/schema/auth.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    host: dbUrl.hostname,
    port: Number(dbUrl.port || "5432"),
    user: decodeURIComponent(dbUrl.username),
    password: decodeURIComponent(dbUrl.password),
    database: dbUrl.pathname.replace(/^\//, ""),
    ssl: "require",
  },
});
