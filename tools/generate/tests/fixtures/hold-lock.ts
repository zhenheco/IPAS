import { acquireLock } from "../../src/lock.js";

await acquireLock(process.argv[2]!);
console.log("locked");
setInterval(() => {}, 1000);
