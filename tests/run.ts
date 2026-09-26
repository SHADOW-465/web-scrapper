/** Offline self-checks for every engine module. Run: npm test */
import * as records from "../lib/records";
import * as ssrf from "../lib/ssrf";
import * as token from "../lib/token";
import * as replay from "../lib/replay";
import * as correlate from "../lib/correlate";
import * as exporters from "../lib/exporters";
import * as model from "../lib/model";
import * as items from "../lib/items";
import * as itemsClient from "../lib/items-client";
import * as snapshot from "../lib/snapshot";

let failed = 0;
for (const [name, mod] of Object.entries({ records, ssrf, token, replay, correlate, exporters, model, items, itemsClient, snapshot })) {
  try {
    console.log("pass ", (mod as { selfCheck: () => string }).selfCheck());
  } catch (e) {
    failed++;
    console.log("FAIL ", name, (e as Error).message);
  }
}
process.exit(failed ? 1 : 0);
