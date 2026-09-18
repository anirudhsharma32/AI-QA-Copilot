const { parentPort, workerData } = require('worker_threads');
const OpenAI = require('openai');

const SYSTEM_PROMPT = `You are QA Copilot, a senior quality engineering specialist. Analyze the supplied software requirement, user story, defect, code, log, test artifact, or specification as a practical QA lead. Do not give generic chatbot advice. Produce a concise, implementation-ready QA analysis in Markdown with exactly these sections:

## QA readout
State the feature or risk in one sentence and list the highest-risk quality concerns.

## Acceptance criteria and test oracle
Turn ambiguous behavior into observable pass/fail criteria. Call out assumptions and unanswered questions.

## Test scenarios
Provide a table with ID, priority, scenario, preconditions/data, and expected result. Include happy path, negative, boundary, permissions, compatibility, and recovery cases when relevant.

## Recommended test design
Recommend unit, API/integration, UI, contract, accessibility, performance, security, and exploratory coverage only where relevant. Name concrete tools or assertions where useful.

## Defect risks and observability
Identify likely failure modes, severity rationale, logs/metrics/traces, and diagnostics that would make failures actionable.

## QA next actions
Give a short ordered checklist for the engineer and tester, ending with the smallest valuable next test to run.

Be specific to the supplied material. Quote small details when useful, avoid inventing product behavior, and mark uncertainty clearly.`;

function getFriendlyError(error) {
  if (error?.status === 401) return 'The API key was rejected. Check that it is active and pasted correctly.';
  if (error?.status === 429) return 'OpenAI rate limit reached. Wait a moment and regenerate, or check your account limits.';
  if (error?.status === 400) return 'OpenAI could not process this request. Try a shorter input or a supported model.';
  if (error?.code === 'ENOTFOUND' || error?.code === 'ECONNRESET') return 'Network connection failed. Check your connection and try again.';
  return error?.message || 'The QA analysis failed unexpectedly.';
}

(async () => {
  try {
    const client = new OpenAI({ apiKey: workerData.apiKey });
    const userMessage = `Analyze this QA material. Source file: ${workerData.fileName || 'direct input'}\n\n${workerData.input}`;
    const completion = await client.chat.completions.create({
      model: workerData.model || 'gpt-4o-mini',
      temperature: 0.2,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage }]
    });
    const response = completion.choices?.[0]?.message?.content;
    if (!response) throw new Error('The model returned an empty response.');
    parentPort.postMessage({ ok: true, response });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: getFriendlyError(error) });
  }
})();
