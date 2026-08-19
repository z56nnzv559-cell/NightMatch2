import { execFileSync } from "node:child_process";

if (process.env.WORKERS_CI !== "1") {
  process.exit(0);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const run = (args, capture = false) =>
  execFileSync(npx, ["wrangler", ...args], capture
    ? { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
    : { stdio: "inherit" });

const buckets = ["akari-originals", "akari-kyc"];
const existing = run(["r2", "bucket", "list"], true);

for (const name of buckets) {
  if (existing.includes(name)) {
    console.log(`R2 bucket already exists: ${name}`);
    continue;
  }
  console.log(`Creating R2 bucket: ${name}`);
  run(["r2", "bucket", "create", name]);
}
