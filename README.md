# ArcVault Intake & Triage

An AI workflow for the Valsoft AI Engineer assessment. It takes a customer message from a webhook, classifies it, pulls out the key details, routes it to a team queue or to Human Review, and saves a JSON record with a short summary.

**Demo:** I'll run the workflow live during the technical interview.

## Run it

Needs Node 22.18 or newer and a free Groq API key from [console.groq.com/keys](https://console.groq.com/keys).

```bash
npm install
cp .env.example .env        # then paste your key after LLM_API_KEY=
npm start                   # terminal 1: starts the webhook at http://localhost:3000/intake
npm run send                # terminal 2: sends the sample messages
```

Records are saved in `output/`. `npm test` runs the unit tests (no API key needed).

## Files to look at

- [output/records.json](output/records.json): the output for the 5 sample messages from the assessment, plus 2 extra edge cases (a $1,200 billing error and a thank-you note)
- [docs/writeup.md](docs/writeup.md): the architecture write-up
- [docs/prompts.md](docs/prompts.md): the prompts, with an explanation for each

