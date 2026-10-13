import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import openapiTS, { astToString } from "openapi-typescript";

const workspaceRoot = resolve(process.cwd(), "..");
const inputPath = resolve(workspaceRoot, "backend", "openapi", "openapi.json");
const outputPath = resolve(process.cwd(), "src", "types", "api.generated.d.ts");

const schema = JSON.parse(await readFile(inputPath, "utf8"));
const expected = astToString(await openapiTS(schema)).trim();
const actual = (await readFile(outputPath, "utf8")).trim();

if (expected !== actual) {
  console.error("OpenAPI type drift detected. Run `npm run types:emit` in frontend.");
  process.exit(1);
}

console.log("OpenAPI types are in sync.");
