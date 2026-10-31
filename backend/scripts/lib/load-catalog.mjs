// Loads the storefront's hard-coded catalogue (src/lib/catalog.ts) as plain data, without Vite.
// Image imports become their asset names ("handbag", "hero", ...); the real collection filter
// functions are kept so collection membership is computed exactly as the storefront does today.
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const assetsDir = join(repoRoot, "src", "assets");

export async function loadCatalog() {
  const source = readFileSync(join(repoRoot, "src", "lib", "catalog.ts"), "utf8");

  const assetFiles = new Map();
  const withoutImports = source.replace(
    /^import (\w+) from "@\/assets\/([\w-]+\.jpg)";\r?\n/gm,
    (_, name, file) => {
      assetFiles.set(name, file);
      return "";
    },
  );
  if (assetFiles.size === 0) throw new Error("No asset imports found in catalog.ts");

  const names = [...assetFiles.keys()];
  const prelude = names.map((n) => `const ${n} = ${JSON.stringify(n)};`).join("\n");
  const js = stripTypeScriptTypes(`${prelude}\n${withoutImports}`);

  const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  return { PRODUCTS: mod.PRODUCTS, COLLECTIONS: mod.COLLECTIONS, COLOURS: mod.COLOURS, assetFiles };
}
