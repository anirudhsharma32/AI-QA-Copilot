# AI QA Copilot

AI QA Copilot is a focused desktop QA workspace for turning requirements, defects, code, logs, and specifications into practical test intelligence. It uses Electron for the desktop shell, HTML/CSS/JavaScript for the frontend, Node.js for the backend bridge, and an isolated worker thread for the OpenAI request.

## Requirements

- Node.js 18 or newer
- An OpenAI API key with access to the selected model
- macOS, Windows, or Linux

## Install and run

```bash
cd ai-qa-copilot
npm install
npm start
```

The application opens as a desktop window. Enter the API key into the password-style field at runtime. The key is held in memory only for the request, is never written to a settings file, and is cleared when the window closes. The renderer cannot access Node.js or the filesystem directly; file selection and saving are handled through Electron's protected preload bridge.

To connect GitHub, create a fine-grained personal access token with read-only access, paste it into the GitHub token field, and choose **Connect GitHub**. The app validates the token against GitHub's API, keeps it only in the Electron main process memory, and clears it when disconnected or when the app closes. The current connection is read-only and does not persist the token.

## Features

- QA-specific analysis prompt with risk readout, acceptance criteria, test scenarios, test design, observability, and next actions
- Model selection for `gpt-4o-mini`, `gpt-4o`, and `gpt-4.1-mini`
- File intake for TXT, CSV, JSON, LOG, Python, JavaScript, TypeScript, Java, SQL, Markdown, DOC, DOCX, PDF, and other text-readable files
- 2 MB file-size guard and 30,000-character input limit
- Generate, clear, copy, save as Markdown, and regenerate actions
- Background worker thread so the UI stays responsive during an API call
- Validation plus friendly handling for invalid keys, network failures, malformed requests, rate limits, empty responses, and oversized files

## Example usage

1. Enter an OpenAI API key.
2. Select a model, usually `gpt-4o-mini` for a quick first pass.
3. Paste a story such as: `A user can reset a password using an email link that expires after 15 minutes.`
4. Click **Generate QA analysis**.
5. Review the acceptance criteria, scenario table, risks, and next action. Copy or save the resulting Markdown for your test plan.

## Architecture

- `src/index.html`: desktop UI structure
- `src/styles.css`: responsive visual system
- `src/renderer.js`: UI state and rendering
- `src/main.js`: Electron window, dialogs, and IPC handlers
- `src/preload.js`: minimal context-isolated API bridge
- `src/qa-worker.js`: OpenAI client and QA prompt in a worker thread

The app intentionally does not use Tkinter: Tkinter is a Python desktop UI toolkit, while this requested application uses HTML/CSS/JavaScript with a Node.js backend. Electron provides the matching desktop runtime without introducing a second UI stack.
