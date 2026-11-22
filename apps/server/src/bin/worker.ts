import { main } from "../worker/main.ts";

// Unlike the api, the worker ends the process itself: after a missed shutdown deadline BullMQ's lock
// renewal timer keeps the event loop alive. pino writes to stdout synchronously, so nothing is lost.
const code = await main(process.argv.slice(2));
process.exit(code);
