import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "../db/client.js";
import { scanLibraryRoot } from "./scan.js";

interface WorkerInput {
  libraryRootId: number;
  containerPath: string;
  databasePath: string;
}

async function main() {
  const { libraryRootId, containerPath, databasePath } = workerData as WorkerInput;
  const { sqlite } = openDatabase(databasePath);

  try {
    const result = await scanLibraryRoot(sqlite, libraryRootId, containerPath, (progress) => {
      parentPort?.postMessage({ type: "progress", progress });
    });
    parentPort?.postMessage({ type: "done", result });
  } catch (err) {
    parentPort?.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    sqlite.close();
  }
}

main();
