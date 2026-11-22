import { main } from "../api/main.ts";

process.exitCode = await main(process.argv.slice(2));
