// Step 1 (ingestion): a webhook. A POST starts the whole workflow; the reply is the finished record.
import express from "express";
import { z } from "zod";
import { processMessage } from "./pipeline.ts";
import { IntakeRequest } from "./schemas.ts";
import { OUTPUT_DIR, saveRecord } from "./store.ts";

const app = express();
app.use(express.json());

app.post("/intake", async (req, res) => {
  const parsed = IntakeRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }
  const record = await processMessage(parsed.data);
  await saveRecord(record);
  const classification = record.classification;
  console.log(
    `${record.id}  ${classification ? `${classification.category} (${classification.confidence})` : "unclassified"}  →  ${record.routing.destination_queue}` +
      (record.routing.escalated ? `  [${record.routing.escalation_reasons.map((reason) => reason.rule).join(", ")}]` : ""),
  );
  res.json(record);
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => console.log(`ArcVault intake webhook: POST http://localhost:${PORT}/intake  (records → ${OUTPUT_DIR}/)`));
