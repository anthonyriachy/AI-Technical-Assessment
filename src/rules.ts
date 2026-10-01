// The business rules, as pure functions with no I/O and no LLM calls.
import {
  type Category,
  type EscalationReason,
  type Identifier,
  type TeamQueue,
} from "./schemas.ts";

export const CONFIDENCE_THRESHOLD = 0.7;
export const BILLING_ERROR_THRESHOLD = 500;

// ---- Grounding: extracted values must appear in the message ----
// Catches values the model invented. An invented value is dropped with a warning; the record doesn't fail.

// Tolerates the harmless differences a model introduces when quoting: case, whitespace, curly quotes, dashes.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// Keeps only the IDs, invoice numbers and error codes that appear in the message.
export function groundIdentifiers(identifiers: Identifier[], message: string) {
  const text = normalize(message);
  const kept = identifiers.filter((identifier) => identifier.value.trim() !== "" && text.includes(normalize(identifier.value)));
  const dropped = identifiers.filter((identifier) => !kept.includes(identifier));
  return { kept, warnings: dropped.map((identifier) => `Dropped identifier not found in message: ${identifier.type} "${identifier.value}"`) };
}

// The urgency quote must be the customer's words; otherwise it becomes null.
export function groundQuote(quote: string | null, message: string) {
  if (quote === null || normalize(message).includes(normalize(quote))) return { quote, warnings: [] };
  return { quote: null, warnings: [`Dropped urgency_evidence not found in message: "${quote}"`] };
}

// ---- Billing error amount: the size of the error, not of the invoice ----

export function billingErrorAmount(billing: {
  disputed: boolean;
  charged_amount: number | null;
  expected_amount: number | null;
}): number | null {
  if (!billing.disputed) return null;
  const { charged_amount: charged, expected_amount: expected } = billing;
  if (charged !== null && expected !== null) return Math.abs(charged - expected); // undercharges count too
  return charged ?? expected; // one amount: a rough guess (the real error can be bigger if only the expected amount is given); none: unknown (null)
}

// ---- Keywords: run on the raw message, can't be argued with ----

// A backstop for outages the model mislabels; whole phrases only, so "usage is down" doesn't match.
export const OUTAGE_PATTERNS = [
  /\boutages?\b/i,
  /\bdown for (?:all users|everyone)\b/i,
  /\barcvault is down\b/i,
  /\bno one can log in\b/i,
];

export const INJECTION_PATTERNS = [
  /\bignore (?:all |any |the )?(?:previous|prior|above) instructions\b/i,
  /\bdisregard (?:all |the )?(?:previous|prior|above)\b/i,
  /\bsystem prompt\b/i,
  /\bclassify (?:this|it|me) as\b/i,
  /\bset the (?:priority|category|confidence) to\b/i,
  /\b(?:do not|don't|don’t) escalate\b/i,
  /<\/?customer_message>/i,
];

export function matchKeywords(message: string, patterns: RegExp[]): string[] {
  return patterns.flatMap((pattern) => message.match(pattern)?.[0] ?? []);
}

// ---- Routing ----

export const QUEUE_FOR: Record<Category, TeamQueue> = {
  "Bug Report": "Engineering",
  "Incident/Outage": "Engineering",
  "Feature Request": "Product",
  "Billing Issue": "Billing",
  "Technical Question": "Support",
};

// ---- Escalation: every rule that fires is reported, not just the first ----

export function findEscalationReasons(input: {
  message: string;
  category: Category;
  confidence: number;
  billing: { disputed: boolean; errorAmount: number | null } | null; // null if enrichment failed
}): EscalationReason[] {
  const escalationReasons: EscalationReason[] = [];

  if (input.confidence < CONFIDENCE_THRESHOLD) {
    escalationReasons.push({ rule: "low_confidence", detail: `Confidence ${input.confidence.toFixed(2)} < ${CONFIDENCE_THRESHOLD.toFixed(2)}` });
  }

  // Outage: the model's category, or outage wording in case the model calls it something else.
  const outageHits = matchKeywords(input.message, OUTAGE_PATTERNS);
  const outageDetails = [
    ...(input.category === "Incident/Outage" ? ["Classified as Incident/Outage"] : []),
    ...(outageHits.length > 0 ? [`Outage wording: ${outageHits.map((keyword) => `"${keyword}"`).join(", ")}`] : []),
  ];
  if (outageDetails.length > 0) escalationReasons.push({ rule: "outage", detail: outageDetails.join("; ") });

  if (input.billing?.disputed) {
    const amount = input.billing.errorAmount;
    if (amount === null) escalationReasons.push({ rule: "billing_error", detail: "Disputed charge, amount unclear" });
    else if (amount >= BILLING_ERROR_THRESHOLD) {
      escalationReasons.push({ rule: "billing_error", detail: `Billing error $${amount} ≥ $${BILLING_ERROR_THRESHOLD}` });
    }
  }

  const injectionHits = matchKeywords(input.message, INJECTION_PATTERNS);
  if (injectionHits.length > 0) {
    escalationReasons.push({ rule: "prompt_injection", detail: `Instruction-like text: ${injectionHits.map((keyword) => `"${keyword}"`).join(", ")}` });
  }

  return escalationReasons;
}
