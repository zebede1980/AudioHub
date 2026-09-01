// Dev-only bootstrap: Worker threads don't inherit the parent's tsx loader automatically, so
// this plain-JS entry point uses tsx's own tsImport() to load the real (TypeScript) worker module
// with the loader registered correctly for this thread. Not used in production — the compiled
// build spawns dist/worker.js directly.
import { tsImport } from "tsx/esm/api";

await tsImport("./worker.ts", import.meta.url);
