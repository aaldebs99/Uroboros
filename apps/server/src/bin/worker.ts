import { main } from "../worker/main.ts";

// Unlike the api, the worker ends the process itself: after a missed shutdown deadline BullMQ's lock
// renewal timer keeps the event loop alive. pino's default destination is asynchronous (SonicBoom
// with sync: false); buffered lines survive process.exit because pino flushes it synchronously on
// 'exit' (on-exit-leak-free). A worker-thread transport would not get that guarantee.
const code = await main(process.argv.slice(2));
process.exit(code);
