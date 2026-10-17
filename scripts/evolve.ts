// Version N+1 from the command line: npm run evolve [-- --repeats 2]
import { evolve } from "../lib/evolve";

const i = process.argv.indexOf("--repeats");
const repeats = i > 0 ? Number(process.argv[i + 1]) || 1 : 1;
const t0 = Date.now();
evolve({ repeats, log: (s) => console.log(`[${new Date().toLocaleTimeString("en-US", { hour12: false })}] ${s}`) })
  .then((r) => {
    console.log(`\nKept v${r.current} (${r.kept ? "candidate kept" : "candidate discarded"}). Held-out: ${r.heldout.before} → ${r.heldout.after}. ${Math.round((Date.now() - t0) / 1000)} s. Summary: ${r.file}`);
  })
  .catch((e) => {
    console.error("evolve failed:", e);
    process.exit(1);
  });
