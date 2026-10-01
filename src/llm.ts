import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { CLASSIFY_SYSTEM, ENRICH_SYSTEM, SUMMARY_SYSTEM, wrapMessage } from "./prompts.ts";
import { ClassifyOutput, EnrichOutput, SummaryOutput } from "./schemas.ts";

const BASE_URL = process.env.LLM_BASE_URL;
export const MODEL = process.env.LLM_MODEL;
export const PROVIDER = BASE_URL ? new URL(BASE_URL).hostname : "unknown";

const client = new OpenAI({ apiKey: process.env.LLM_API_KEY, baseURL: BASE_URL, maxRetries: 6 });

async function callStructured<S extends z.ZodType>(name: string, schema: S, system: string, user: string): Promise<z.infer<S>> {
  const res = await client.chat.completions.create({
    model: MODEL ?? "",
    temperature: 0,
    reasoning_effort: "low",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: zodResponseFormat(schema, name),
  });
  return schema.parse(JSON.parse(res.choices[0]?.message?.content ?? ""));
}

export const classify = (source: string, message: string) =>
  callStructured("classify", ClassifyOutput, CLASSIFY_SYSTEM, `Source: ${source}\n${wrapMessage(message)}`);

export const enrich = (message: string) => callStructured("enrich", EnrichOutput, ENRICH_SYSTEM, wrapMessage(message));

export const summarize = (message: string, facts: string) =>
  callStructured("summary", SummaryOutput, SUMMARY_SYSTEM, `${wrapMessage(message)}\n${facts}`);
