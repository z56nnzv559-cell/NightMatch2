import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import type { Env as AkariEnv } from "../src/env";

/* cloudflare:test の env は Cloudflare.Env として型が付く。
   本体の Env に、テストでしか使わない TEST_MIGRATIONS を足す */
declare global {
  namespace Cloudflare {
    interface Env extends AkariEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
