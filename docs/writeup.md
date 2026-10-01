# ArcVault Intake & Triage: Architecture Write-Up

A webhook receives each customer message and runs the same six steps. The LLM does the language work (classify, extract, summarise), and plain code makes every business decision (escalation and routing). A fixed workflow is easier to test and cheaper than an agent, and because the model has no tools, a prompt injection can at most change a label, not take an action.

I used `openai/gpt-oss-120b` on Groq's free tier. It's free, Groq enforces a strict JSON schema for it, and unlike `gpt-oss-20b`, its confidence scores vary: on my 20 test messages, 20b gave 0.95 to 19 of them, even the wrong answers. It runs at temperature 0 with low reasoning effort. Results are mostly stable, but urgency, confidence and summary wording vary a little between runs.

## 1. System design

```
POST /intake {source, message}                          Step 1  Express webhook; Zod rejects bad input (400)
  → Classify (LLM) ─┐ in parallel                       Step 2  category, confidence, priority
  → Enrich   (LLM) ─┘                                   Step 3  core issue, identifiers, urgency + quote, billing amounts
  → code: grounding, billing error amount               Step 3  drop made-up values; calculate the error amount
  → code: escalation rules → routing                    Steps 6 + 4
  → Summary  (LLM)                                      Step 5  2-3 sentences, written after routing
  → output/records.jsonl + output/queues/<queue>.jsonl  Step 5  the full record, saved to files
```

- Trigger: a POST starts the pipeline, and the response is the finished record. Classify and Enrich run in parallel. The summary runs last, so it can say where the message went and why.
- State: only in files. `records.jsonl` holds every record, and each queue has its own file. Each record saves the model and prompt version.
- Checks: every LLM reply must pass the strict JSON schema, then Zod. Category, priority and urgency come from fixed lists. Identifiers and the urgency quote must appear in the message, or they're dropped.
- Failures: the SDK retries rate limits and server errors. If Classify or Enrich still fails, the record goes to Human Review as `processing_failed`. If only the summary fails, the record keeps its routing and gets a placeholder summary.



## 2. Routing logic


| Category                    | Queue        | Why                                                              |
| --------------------------- | ------------ | ---------------------------------------------------------------- |
| Bug Report, Incident/Outage | Engineering  | I assume the same team fixes both                                |
| Feature Request             | Product      |                                                                  |
| Billing Issue               | Billing      |                                                                  |
| Technical Question          | Support      | how-to and pricing questions need someone who talks to customers |
| any escalation              | Human Review | Step 6: instead of the normal queue                              |


- Low-confidence messages also go to Human Review (the Step 4 fallback).
- Routing uses only the category of the main request. Tie-break rules in the prompt handle overlaps. For example, "is this expected?" is a Technical Question, and a problem affecting multiple users is an Incident/Outage.



## 3. Escalation logic

Any matching rule sends the message to Human Review, and the record lists every rule that matched. The record also keeps `standard_queue`, the team the category would normally go to (Engineering for #5), so the reviewer can pass it on in one step and the summary can name it. For a low-confidence message, that team is only the model's best guess.


| Rule                                                       | Why                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Confidence < 0.7**                                       | The prompt's score ranges put "one category fits best, another is plausible" at 0.70–0.89, so those messages go to the best-fit team, which can pass them on. The cutoff catches messages that fit no category or where two fit equally. A thank-you note scored 0.30–0.35 and was flagged. The score is the model's own estimate, so outages, large billing errors and injection attempts have their own rules. |
| **Outage:** category = Incident/Outage, or outage wording  | The category is the main check, because sample #5 never says "outage". The assessment's example keywords (`outage`, `down for all users`, plus `down for everyone`, `ArcVault is down`, `no one can log in`) are a backstop that doesn't depend on the model, so an outage it labels as a Bug Report still escalates. Whole phrases only, so "our usage is down" doesn't match.                                |
| **Billing error ≥ $500**, by the size of the error         | "Billing error" means the amount that's wrong, not the invoice total. Sample #3's $1,240 invoice is only $260 off, so it goes to Billing. If ArcVault meant the invoice total, it's a one-line change. With only one amount, I use it as the error. With no amount, it escalates. Refunds aren't disputes.                                                                                                       |
| **Prompt injection** (e.g. "ignore previous instructions") | A pattern check in code that the model can't argue with. The main protection is the design: a fixed output format, no tools, and decisions in code.                                                                                                                                                                                                                                                              |
| **Processing failure**                                     | No message is lost because of an LLM failure.                                                                                                                                                                                                                                                                                                                                                                    |




## 4. At production scale

**Reliability.** Today the webhook waits for all three AI calls to finish before it answers, so if the server crashes in the middle, that message is lost. In production I'd save every message first, answer "received" right away, and process it in the background. Failed messages get retried, and ones that keep failing are set aside for a person to check. Each message also needs an ID, so an email sent twice doesn't become two tickets. The code works with any OpenAI-compatible provider that offers a reasoning model with strict JSON schemas, so if Groq goes down, production should switch to a backup provider. And every prompt or model change should be re-tested on messages with known correct answers first: here, rewording a prompt without changing its meaning changed one answer.

**Cost.** A message uses a few thousand tokens over 3 calls. At Groq's paid price ($0.15 per million input tokens, $0.60 per million output), that's roughly $1 per 1,000 messages. The real cost is people: every escalation is someone reading a ticket. So the 0.7 and $500 thresholds should be tuned by weighing the cost of a missed case against how many reviews the team can handle.

**Latency.** A message normally takes 1 to 3 seconds, or 15 to 20 seconds when Groq's free-tier limit makes the code wait and retry. No customer is waiting on the routing, so that's fine. What matters is how fast a problem reaches the right team. Today an outage waits in Human Review, but in production it should also alert the on-call engineer right away. A paid plan's higher limits remove most of the waiting.

## 5. Phase 2 (another week)

1. Learn from corrections. When a team moves a ticket to another queue, save it as an example with the right answer. The test set grows every week and shows where the prompts go wrong.
2. Better confidence. The model rates how well each category fits ("clear / partial / none"), code calculates the score, and the real examples set the threshold.
3. Real billing checks. Look up the invoice in the billing system, so the error amount is a fact instead of the customer's claim. This also fixes refund vs dispute and other currencies.
4. Outages and safety. Group outage messages into one incident and alert once, and add a trained model that spots prompt injection (Llama Prompt Guard is available on Groq).
5. A Human Review helper. This is where an AI agent makes sense: a small assistant that can look up account history, similar tickets and system status (but can't change anything), so the reviewer decides faster.
6. Messages with two requests: split them and route each part to its team.

Assumptions: amounts are in USD, the customer's numbers are taken as true, a message that fits no category should get low confidence (there's no "Other" category), and each message goes to one team queue.