import { main } from "../notices/notices.ts";

process.exitCode = main(process.argv.slice(2));
