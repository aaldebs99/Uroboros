import { main } from "../api/main.ts";

// Like the worker, the api ends the process itself: after a drain that timed out, a cut request's
// handler (a hung query, say) can keep the event loop alive. pino's default destination is
// asynchronous, but pino flushes it synchronously on 'exit', so buffered lines survive.
const code = await main(process.argv.slice(2));
process.exit(code);
