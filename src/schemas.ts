// Every shape that crosses a boundary: the webhook request, the three LLM outputs, and the output record.
// The LLM output schemas double as the strict JSON schema sent to Groq (via zodResponseFormat).
import { z } from "zod";

export const Category = z.enum(["Bug Report", "Feature Request", "Billing Issue", "Technical Question", "Incident/Outage"]);
export type Category = z.infer<typeof Category>;

export const Priority = z.enum(["Low", "Medium", "High"]);
export type Priority = z.infer<typeof Priority>;

export const Urgency = z.enum(["none", "low", "medium", "high"]);
export const Source = z.enum(["Email", "Web Form", "Support Portal"]);

export const TeamQueue = z.enum(["Engineering", "Product", "Billing", "Support"]);
export type TeamQueue = z.infer<typeof TeamQueue>;
export const Queue = z.enum([...TeamQueue.options, "Human Review"]);
export type Queue = z.infer<typeof Queue>;

export const EscalationRule = z.enum([
  "low_confidence",
  "outage",
  "billing_error",
  "prompt_injection",
  "processing_failed",
]);
export const EscalationReason = z.object({ rule: EscalationRule, detail: z.string() });
export type EscalationReason = z.infer<typeof EscalationReason>;

// ---- Step 1: webhook request ----

export const IntakeRequest = z.object({
  source: Source,
  message: z.string().trim().min(1, "message must not be empty"),
});
export type IntakeRequest = z.infer<typeof IntakeRequest>;

// ---- LLM outputs (strict mode: every field required, nullable instead of optional) ----

export const ClassifyOutput = z.object({
  category: Category,
  confidence: z.number(), // the model's self-reported confidence in the category, 0–1
  priority: Priority,
});
export type ClassifyOutput = z.infer<typeof ClassifyOutput>;

export const Identifier = z.object({
  type: z.enum(["account_id", "invoice_number", "error_code", "other"]),
  value: z.string(),
});
export type Identifier = z.infer<typeof Identifier>;

export const EnrichOutput = z.object({
  core_issue: z.string(),
  identifiers: z.array(Identifier),
  urgency: Urgency,
  urgency_evidence: z.string().nullable(),
  billing: z.object({
    disputed: z.boolean(),
    charged_amount: z.number().nullable(),
    expected_amount: z.number().nullable(),
  }),
});
export type EnrichOutput = z.infer<typeof EnrichOutput>;

export const SummaryOutput = z.object({ summary: z.string() });

// ---- Output record ----

export const TriageRecord = z.object({
  id: z.string(),
  received_at: z.string(),
  source: Source,
  raw_message: z.string(),
  classification: z
    .object({
      category: Category,
      confidence: z.number(),
      priority: Priority,
    })
    .nullable(),
  enrichment: z
    .object({
      core_issue: z.string(),
      identifiers: z.array(Identifier),
      urgency: Urgency,
      urgency_evidence: z.string().nullable(),
      billing: z.object({
        disputed: z.boolean(),
        charged_amount: z.number().nullable(),
        expected_amount: z.number().nullable(),
        error_amount: z.number().nullable(),
      }),
    })
    .nullable(),
  routing: z.object({
    destination_queue: Queue,
    standard_queue: TeamQueue.nullable(), // the category's team, kept on escalated records too; null if unclassified
    escalated: z.boolean(),
    escalation_reasons: z.array(EscalationReason),
  }),
  summary: z.string(),
  meta: z.object({
    processed_at: z.string(),
    provider: z.string(),
    model: z.string(),
    prompt_version: z.string(),
    schema_version: z.string(),
    warnings: z.array(z.string()),
  }),
});
export type TriageRecord = z.infer<typeof TriageRecord>;
