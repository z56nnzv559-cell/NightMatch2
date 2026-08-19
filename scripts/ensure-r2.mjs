import { execFileSync } from "node:child_process";
import fs from "node:fs";

if (process.env.WORKERS_CI !== "1") {
  process.exit(0);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const run = (args, capture = false) =>
  execFileSync(npx, ["wrangler", ...args], capture
    ? { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
    : { stdio: "inherit" });

// R2: ensure the two required private buckets exist.
const buckets = ["akari-originals", "akari-kyc"];
const existingBuckets = run(["r2", "bucket", "list"], true);

for (const name of buckets) {
  if (existingBuckets.includes(name)) {
    console.log(`R2 bucket already exists: ${name}`);
    continue;
  }
  console.log(`Creating R2 bucket: ${name}`);
  run(["r2", "bucket", "create", name]);
}

// KV: avoid relying on beta automatic provisioning in Workers Builds.
const kvTitle = "nightmatch2-cache";
const readKvNamespaces = () => {
  const raw = run(["kv", "namespace", "list"], true);
  try {
    return JSON.parse(raw);
  } catch {
    console.error("Could not parse KV namespace list:", raw);
    throw new Error("Failed to read KV namespaces");
  }
};

let namespaces = readKvNamespaces();
let cache = namespaces.find((ns) => ns.title === kvTitle);

if (!cache) {
  console.log(`Creating KV namespace: ${kvTitle}`);
  run(["kv", "namespace", "create", kvTitle]);
  namespaces = readKvNamespaces();
  cache = namespaces.find((ns) => ns.title === kvTitle);
}

if (!cache?.id) {
  throw new Error(`KV namespace ${kvTitle} was not created or has no id`);
}

const configPath = "wrangler.jsonc";
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
config.kv_namespaces = [{ binding: "CACHE", id: cache.id }];
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Bound CACHE to KV namespace ${kvTitle} (${cache.id})`);
