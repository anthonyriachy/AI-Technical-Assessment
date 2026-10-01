// Persistence: every record in one JSONL file, plus a copy in its destination queue's file.
import { appendFile, mkdir } from "node:fs/promises";
import type { TriageRecord } from "./schemas.ts";

export const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "output";

// "Human Review" → "human-review"
const queueFile = (queue: string) => `${OUTPUT_DIR}/queues/${queue.toLowerCase().replace(/\s+/g, "-")}.jsonl`;

export async function saveRecord(record: TriageRecord): Promise<void> {
  await mkdir(`${OUTPUT_DIR}/queues`, { recursive: true });
  const line = JSON.stringify(record) + "\n";
  await appendFile(`${OUTPUT_DIR}/records.jsonl`, line);
  await appendFile(queueFile(record.routing.destination_queue), line);
}
