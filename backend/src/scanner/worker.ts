import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "../db/client.js";
import { scanLibraryRoot, indexFilePaths } from "./scan.js";

interface WorkerInput {
  libraryRootId: number;
  containerPath: string;
  databasePath: string;
  /** When present, index exactly these library-relative paths instead of walking the whole root. */
  relativePaths?: string[];
}

async function main() {
  const { libraryRootId, containerPath, databasePath, relativePaths } = workerData as WorkerInput;
  const { sqlite } = openDatabase(databasePath);

  try {
    const onProgress = (progress: unknown) => parentPort?.postMessage({ type: "progress", progress });
    const result = relativePaths
      ? await indexFilePaths(sqlite, libraryRootId, containerPath, relativePaths, onProgress)
      : await scanLibraryRoot(sqlite, libraryRootId, containerPath, onProgress);
    parentPort?.postMessage({ type: "done", result });
  } catch (err) {
    parentPort?.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    sqlite.close();
  }
}

main();
