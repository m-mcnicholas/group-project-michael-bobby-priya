import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const output = fileURLToPath(new URL("dist/", root));
mkdirSync(output, { recursive: true });
cpSync(fileURLToPath(new URL("landing/", root)), output, { recursive: true });
console.log(`Prepared DuckPlan static assets in ${output}`);
