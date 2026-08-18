const form = document.getElementById("run-form");
const commandInput = document.getElementById("command");
const runBtn = document.getElementById("run-btn");
const stopBtn = document.getElementById("stop-btn");
const clearBtn = document.getElementById("clear-btn");
const linesEl = document.getElementById("lines");
const placeholder = document.getElementById("placeholder");
const cursor = document.getElementById("cursor");
const consoleEl = document.getElementById("console");
const badge = document.getElementById("status-badge");
const statusText = document.getElementById("status-text");
const chips = document.getElementById("chips");

let abortController = null;
let lineBuffer = "";

function setStatus(state, label) {
  badge.className = `badge ${state}`;
  statusText.textContent = label;
}

function setRunning(running) {
  runBtn.disabled = running;
  stopBtn.classList.toggle("hidden", !running);
  cursor.classList.toggle("hidden", !running);
  commandInput.disabled = running;
}

function hidePlaceholder() {
  placeholder.classList.add("hidden");
}

function addLine(text, className = "") {
  hidePlaceholder();
  const line = document.createElement("div");
  if (className) line.className = className;
  if (text.startsWith("ERROR:")) line.classList.add("log-error");
  line.textContent = text.length ? text : " ";
  linesEl.appendChild(line);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function flushBuffer() {
  if (lineBuffer.length) {
    addLine(lineBuffer);
    lineBuffer = "";
  }
}

function appendOutput(chunk) {
  lineBuffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = lineBuffer.split("\n");
  lineBuffer = parts.pop() ?? "";
  for (const part of parts) addLine(part);
}

async function consumeSSE(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const dataLine = event.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      onEvent(JSON.parse(dataLine.slice(6)));
    }
  }
}

async function runPipeline(command) {
  if (abortController) return;
  abortController = new AbortController();
  lineBuffer = "";

  hidePlaceholder();
  addLine(`$ ${command}`, "log-cmd");
  setRunning(true);
  setStatus("running", "Running");

  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(err.error || "Request failed");
    }

    await consumeSSE(response, (event) => {
      if (event.type === "log") {
        appendOutput(event.output || "");
      } else if (event.type === "error") {
        flushBuffer();
        addLine(`ERROR: ${event.message}`, "log-error");
        setStatus("error", "Failed");
      } else if (event.type === "done") {
        flushBuffer();
        addLine("✓ Pipeline finished", "log-done");
        setStatus("done", "Done");
      }
    });

    flushBuffer();
    if (badge.classList.contains("running")) {
      addLine("✓ Pipeline finished", "log-done");
      setStatus("done", "Done");
    }
  } catch (err) {
    if (err.name === "AbortError") {
      flushBuffer();
      addLine("■ Pipeline stopped", "log-meta");
      setStatus("", "Stopped");
    } else {
      flushBuffer();
      addLine(`ERROR: ${err.message}`, "log-error");
      setStatus("error", "Failed");
    }
  } finally {
    setRunning(false);
    abortController = null;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const command = commandInput.value.trim();
  if (!command) return;
  runPipeline(command);
});

stopBtn.addEventListener("click", () => {
  abortController?.abort();
});

clearBtn.addEventListener("click", () => {
  linesEl.replaceChildren();
  placeholder.classList.remove("hidden");
  setStatus("", "Idle");
});

chips.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-cmd]");
  if (!button) return;
  commandInput.value = button.dataset.cmd;
  commandInput.focus();
});
