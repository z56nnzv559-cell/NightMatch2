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

// KV: reuse an existing NightMatch cache namespace if one was already
// created by Wrangler's automatic provisioning or by a previous build.
const readKvNamespaces = () => {
  const raw = run(["kv", "namespace", "list"], true);
  try {
    return JSON.parse(raw);
  } catch {
    console.error("Could not parse KV namespace list:", raw);
    throw new Error("Failed to read KV namespaces");
  }
};

const findCacheNamespace = (namespaces) => {
  const preferred = [
    "nightmatch2-cache",
    "nightmatch2-nightmatch2-cache",
    "nightmatch2-CACHE",
  ];

  for (const title of preferred) {
    const match = namespaces.find((ns) => ns.title === title);
    if (match) return match;
  }

  return namespaces.find((ns) => {
    const title = String(ns.title || "").toLowerCase();
    return title.startsWith("nightmatch2") && title.endsWith("cache");
  });
};

let namespaces = readKvNamespaces();
let cache = findCacheNamespace(namespaces);

if (!cache) {
  console.log("No NightMatch2 cache namespace found; creating CACHE namespace");
  run(["kv", "namespace", "create", "CACHE"]);
  namespaces = readKvNamespaces();
  cache = findCacheNamespace(namespaces);
}

if (!cache?.id) {
  throw new Error("NightMatch2 cache KV namespace was not found or has no id");
}

const configPath = "wrangler.jsonc";
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
config.kv_namespaces = [{ binding: "CACHE", id: cache.id }];
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Bound CACHE to existing KV namespace ${cache.title} (${cache.id})`);

// D1: the Git-connected deploy previously created/bound the database but did
// not apply the schema migrations. Apply all pending migrations before
// wrangler deploy so the production Worker never runs against an empty DB.
console.log("Applying pending D1 migrations to akari...");
run(["d1", "migrations", "apply", "akari", "--remote"]);
console.log("D1 migrations are up to date");
