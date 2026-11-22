import { main } from "../gen/main.ts";

process.exitCode = await main(process.argv.slice(2));
