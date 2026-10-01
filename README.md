## Run it

Needs Node 22.18 or newer and a free Groq API key from [console.groq.com/keys](https://console.groq.com/keys).

```bash
npm install
cp .env.example .env        # then paste your key after LLM_API_KEY=
npm start                   # terminal 1: starts the webhook at http://localhost:3000/intake
npm run send                # terminal 2: sends the sample messages
```

Terminal 2 prints one line per message (category → queue, plus any escalation rules). Full records are added to `output/records.jsonl` and to each queue's file in `output/queues/`. Run `npm run export` to rebuild `output/records.json`. `output/` already has the submitted run, so new records are added after those 7.

On Groq's free tier, some calls hit the rate limit and are retried automatically, so a run can take a minute or two. Waiting a minute between runs helps.

`npm test` runs the unit tests (no API key needed).

## Files to look at

- [output/records.json](output/records.json): the output for the 5 sample messages from the assessment, plus 2 extra edge cases (a $1,200 billing error and a thank-you note)
- [docs/writeup.md](docs/writeup.md): the architecture write-up
- [docs/prompts.md](docs/prompts.md): the prompts, with an explanation for each

