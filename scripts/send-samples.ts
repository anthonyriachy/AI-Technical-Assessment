// Demo driver: simulates messages arriving by POSTing each one to the running webhook, one at a time.
// Usage: npm run send   (the 5 official samples in data/samples.json)
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "data/samples.json";
const url = process.env.INTAKE_URL ?? "http://localhost:3000/intake";
const messages: { id: string; source: string; message: string }[] = JSON.parse(readFileSync(file, "utf8"));

for (const sample of messages) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: sample.source, message: sample.message }),
  });
  const record = await res.json();
  if (!res.ok) {
    console.log(`#${sample.id}  HTTP ${res.status}  ${record.error}`);
    continue;
  }
  const reasons = record.routing.escalation_reasons.map((reason: { rule: string }) => reason.rule).join(", ");
  console.log(`#${sample.id}  ${record.classification?.category ?? "unclassified"}  →  ${record.routing.destination_queue}${reasons ? `  [${reasons}]` : ""}`);
}
