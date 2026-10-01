// One message in, one record out (assessment steps 2–6). LLM calls come from llm.ts, business rules from rules.ts.
// Never throws for LLM problems: a failed step becomes a record escalated to Human Review.
import { randomUUID } from "node:crypto";
import { classify, enrich, MODEL, PROVIDER, summarize } from "./llm.ts";
import { PROMPT_VERSION } from "./prompts.ts";
import {
  billingErrorAmount,
  findEscalationReasons,
  groundIdentifiers,
  groundQuote,
  QUEUE_FOR,
} from "./rules.ts";
import type { EnrichOutput, EscalationReason, IntakeRequest, Queue, TeamQueue } from "./schemas.ts";
import { TriageRecord } from "./schemas.ts";

export const SCHEMA_VERSION = "1";

type Classification = NonNullable<TriageRecord["classification"]>;
type Enrichment = NonNullable<TriageRecord["enrichment"]>;
// An LLM step that still failed after the SDK's retries, or returned invalid output.
type StepFailure = { step: "classify" | "enrich"; error: string };

export async function processMessage({ source, message }: IntakeRequest): Promise<TriageRecord> {
  const received_at = new Date().toISOString();

  // Steps 2 + 3: classify and enrich (LLM), in parallel because neither needs the other.
  const [classifyResult, enrichResult] = await Promise.allSettled([classify(source, message), enrich(message)]);
  const classification = classifyResult.status === "fulfilled" ? classifyResult.value : null;
  const { enrichment, warnings: groundingWarnings } = enrichResult.status === "fulfilled" ? buildEnrichment(enrichResult.value, message) : { enrichment: null, warnings: [] };
  // Failed LLM steps: escalate the record to Human Review (processing_failed) instead of losing the message.
  const failures = failedSteps(classifyResult, enrichResult);

  // Steps 4 + 6: escalation and routing (plain code).
  const escalationReasons = decideEscalation(message, classification, enrichment, failures);
  const escalated = escalationReasons.length > 0;
  // Escalated (or unclassified) → Human Review; otherwise the category's team.
  const standardQueue = classification ? QUEUE_FOR[classification.category] : null;
  const destination: Queue = escalated || !standardQueue ? "Human Review" : standardQueue;

  // Step 5: summary (LLM), written after routing so it can say where the message went and why.
  const summary = await writeSummary({ message, classification, enrichment, destination, standardQueue, escalationReasons, failures });

  return TriageRecord.parse({
    id: `rec_${randomUUID().slice(0, 8)}`,
    received_at,
    source,
    raw_message: message,
    classification,
    enrichment,
    routing: { destination_queue: destination, standard_queue: standardQueue, escalated, escalation_reasons: escalationReasons },
    summary: summary.text,
    meta: {
      processed_at: new Date().toISOString(),
      provider: PROVIDER,
      model: MODEL,
      prompt_version: PROMPT_VERSION,
      schema_version: SCHEMA_VERSION,
      warnings: [...groundingWarnings, ...summary.warnings],
    },
  });
}

// ---- Step 3: enrichment = the model's extraction, with identifiers and the quote checked against the message ----

function buildEnrichment(out: EnrichOutput, message: string): { enrichment: Enrichment; warnings: string[] } {
  // Hallucination check: drop identifiers and quotes not found in the message.
  const ids = groundIdentifiers(out.identifiers, message);
  const quote = groundQuote(out.urgency_evidence, message);
  return {
    enrichment: {
      core_issue: out.core_issue,
      identifiers: ids.kept,
      urgency: out.urgency,
      urgency_evidence: quote.quote,
      billing: { ...out.billing, error_amount: billingErrorAmount(out.billing) },
    },
    warnings: [...ids.warnings, ...quote.warnings],
  };
}

function failedSteps(
  classifyResult: PromiseSettledResult<unknown>,
  enrichResult: PromiseSettledResult<unknown>,
): StepFailure[] {
  const failures: StepFailure[] = [];
  if (classifyResult.status === "rejected") failures.push({ step: "classify", error: errorText(classifyResult.reason) });
  if (enrichResult.status === "rejected") failures.push({ step: "enrich", error: errorText(enrichResult.reason) });
  return failures;
}

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

// ---- Steps 4 + 6: escalation and routing ----

function decideEscalation(
  message: string,
  classification: Classification | null,
  enrichment: Enrichment | null,
  failures: StepFailure[],
): EscalationReason[] {
  const escalationReasons = classification
    ? findEscalationReasons({
        message,
        category: classification.category,
        confidence: classification.confidence,
        billing: enrichment && { disputed: enrichment.billing.disputed, errorAmount: enrichment.billing.error_amount },
      })
    : [];
  if (failures.length > 0) {
    const detail = failures.map((failure) => `${failure.step}: ${failure.error}`).join(" | ");
    escalationReasons.push({ rule: "processing_failed", detail });
  }
  return escalationReasons;
}

// ---- Step 5: summary ----

async function writeSummary(input: {
  message: string;
  classification: Classification | null;
  enrichment: Enrichment | null;
  destination: Queue;
  standardQueue: TeamQueue | null;
  escalationReasons: EscalationReason[];
  failures: StepFailure[];
}): Promise<{ text: string; warnings: string[] }> {
  const { classification, enrichment } = input;
  if (!classification || !enrichment) {
    const steps = input.failures.map((failure) => failure.step).join(", ");
    return { text: `Automatic triage failed (${steps}). Please classify and route manually.`, warnings: [] };
  }

  const facts = [
    `Category: ${classification.category} · Priority: ${classification.priority} · Urgency: ${enrichment.urgency}`,
    `Core issue: ${enrichment.core_issue}`,
    `Identifiers: ${enrichment.identifiers.map((identifier) => `${identifier.type} ${identifier.value}`).join(", ") || "none"}`,
    `Routed to: ${input.destination}`,
    `Standard queue (the category's team): ${input.standardQueue}`,
    `Escalation reasons: ${input.escalationReasons.map((reason) => reason.detail).join("; ") || "none"}`,
  ].join("\n");
  try {
    const result = await summarize(input.message, facts);
    return { text: result.summary, warnings: [] };
  } catch (err) {
    // Routing already succeeded; only the prose is missing, so this does not escalate.
    return {
      text: "Automatic summary failed; see the structured fields of this record.",
      warnings: [`summary failed: ${(err as Error).message}`],
    };
  }
}
