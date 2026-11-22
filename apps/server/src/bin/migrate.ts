import { main } from "../migrate/main.ts";

process.exitCode = await main(process.argv.slice(2));
