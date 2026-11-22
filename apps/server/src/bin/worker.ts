import { main } from "../worker/main.ts";

process.exitCode = await main(process.argv.slice(2));
