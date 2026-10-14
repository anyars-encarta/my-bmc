import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import openapiTS, { astToString } from "openapi-typescript";

const workspaceRoot = resolve(process.cwd(), "..");
const inputPath = resolve(workspaceRoot, "backend", "openapi", "openapi.json");
const outputPath = resolve(process.cwd(), "src", "types", "api.generated.d.ts");

const source = await readFile(inputPath, "utf8");
const schema = JSON.parse(source);
const output = astToString(await openapiTS(schema));

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output, "utf8");
console.log(`Generated ${outputPath}`);
