// output/records.jsonl → output/records.json, a pretty-printed array: the submission file (assessment §4.2).
import { readFileSync, writeFileSync } from "node:fs";
import { OUTPUT_DIR } from "../src/store.ts";

const records = readFileSync(`${OUTPUT_DIR}/records.jsonl`, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
writeFileSync(`${OUTPUT_DIR}/records.json`, JSON.stringify(records, null, 2) + "\n");
console.log(`${records.length} records → ${OUTPUT_DIR}/records.json`);
