import { state } from "./state.js";
import { t } from "./i18n.js";
import { checkYamlSyntax, graphToYaml, yamlToGraph } from "./yaml.js";

const els = {};
let onSave = () => {};
let onMetaChange = () => {};

export function setStatus(statusState, key) {
  state.lastStatus = { state: statusState, key };
  els.badge.className = `badge ${statusState}`.trim();
  els.statusText.textContent = t(key);
}

function makeErrorMarker() {
  const marker = document.createElement("span");
  marker.className = "yaml-error-gutter";
  marker.title = t("yaml.errorMarker");
  marker.textContent = "●";
  return marker;
}

export function setYamlStatus(result) {
  state.lastYamlResult = result;
  els.yamlStatus.classList.remove("ok", "error");
  state.editor.clearGutter("yaml-error");
  if (state.yamlErrorMarker) {
    state.yamlErrorMarker.clear();
    state.yamlErrorMarker = null;
  }

  if (result.valid) {
    els.yamlStatus.classList.add("ok");
    els.yamlStatus.textContent = t("yaml.valid");
    if (!state.dirty) setStatus("done", "status.valid");
    return;
  }

  const { message, line, column } = result.error;
  const where =
    line != null
      ? column != null
        ? t("yaml.whereLineCol", { line, column })
        : t("yaml.whereLine", { line })
      : "YAML";

  els.yamlStatus.classList.add("error");
  els.yamlStatus.textContent = t("yaml.error", { where, message });
  setStatus("error", "status.invalid");

  if (line == null) return;

  const lineIndex = line - 1;
  const lineText = state.editor.getLine(lineIndex) ?? "";
  const startCh = Math.max(0, (column ?? 1) - 1);

  state.editor.setGutterMarker(lineIndex, "yaml-error", makeErrorMarker());
  state.yamlErrorMarker = state.editor.markText(
    { line: lineIndex, ch: startCh },
    { line: lineIndex, ch: lineText.length },
    { className: "yaml-error-text" }
  );
}

export function validateEditorYaml() {
  const result = checkYamlSyntax(state.editor.getValue());
  setYamlStatus(result);
  return result;
}

export async function runYamlCheck() {
  if (state.checkBusy) return;
  state.checkBusy = true;
  els.checkYamlBtn.classList.add("checking");
  els.checkYamlBtn.disabled = true;
  els.checkLabel.textContent = t("yaml.checkingBtn");
  els.yamlStatus.classList.remove("ok", "error");
  els.yamlStatus.textContent = t("yaml.checking");
  setStatus("running", "status.checking");

  await new Promise((resolve) => window.setTimeout(resolve, 450));
  validateEditorYaml();

  els.checkYamlBtn.classList.remove("checking");
  els.checkYamlBtn.disabled = false;
  els.checkLabel.textContent = t("yaml.check");
  state.checkBusy = false;
}

export function writeYamlFromGraph() {
  if (!state.flowCanvas) return;
  state.syncingYaml = true;
  state.editor.setValue(graphToYaml(state.flowCanvas.getGraph()));
  state.syncingYaml = false;
  validateEditorYaml();
}

export function loadGraphFromYaml(content, { preservePositions = false, resetHistory = true } = {}) {
  const previous = preservePositions ? state.flowCanvas?.getGraph() : { nodes: [] };
  state.flowCanvas?.setGraph(yamlToGraph(content ?? "", previous), { resetHistory });
}

export function updateViewButtons() {
  els.viewNodesBtn.classList.toggle("is-active", state.viewMode === "nodes");
  els.viewYamlBtn.classList.toggle("is-active", state.viewMode === "yaml");
  els.viewNodesBtn.setAttribute("aria-selected", state.viewMode === "nodes" ? "true" : "false");
  els.viewYamlBtn.setAttribute("aria-selected", state.viewMode === "yaml" ? "true" : "false");
}

export function applyView(mode) {
  state.viewMode = mode === "yaml" ? "yaml" : "nodes";
  localStorage.setItem("editorView", state.viewMode);
  els.editorCard.dataset.view = state.viewMode;
  document.querySelector(".workspace").dataset.view = state.viewMode;
  updateViewButtons();
  if (state.viewMode === "yaml") {
    window.requestAnimationFrame(() => {
      state.editor.setSize("100%", "100%");
      state.editor.refresh();
    });
  }
}

export function switchView(mode) {
  const next = mode === "yaml" ? "yaml" : "nodes";
  if (next === state.viewMode) return;

  if (next === "nodes") {
    const result = validateEditorYaml();
    if (!result.valid) {
      els.yamlStatus.textContent = t("view.invalidYaml");
      return;
    }
    loadGraphFromYaml(state.editor.getValue(), { preservePositions: true });
  } else if ((state.flowCanvas?.getGraph()?.nodes || []).length) {
    writeYamlFromGraph();
  }

  applyView(next);
}

export function setEditorContent(content) {
  state.loadingFile = true;
  state.editor.setValue(content ?? "");
  state.loadingFile = false;
  state.dirty = false;
  loadGraphFromYaml(content ?? "");
  if ((state.flowCanvas?.getGraph()?.nodes || []).length) {
    const normalized = graphToYaml(state.flowCanvas.getGraph());
    if (normalized !== state.editor.getValue()) {
      state.loadingFile = true;
      state.editor.setValue(normalized);
      state.loadingFile = false;
    }
  }
  onMetaChange();
  validateEditorYaml();
  state.editor.setSize("100%", "100%");
  state.editor.refresh();
}

export function setPreviewMode(on) {
  state.editor.setOption("readOnly", on ? "nocursor" : false);
  els.editorCard.classList.toggle("is-preview", on);
}

export function refreshEditorI18n() {
  if (state.checkBusy) els.checkLabel.textContent = t("yaml.checkingBtn");
  setStatus(state.lastStatus.state, state.lastStatus.key);
  if (state.lastYamlResult) setYamlStatus(state.lastYamlResult);
  updateViewButtons();
}

export function initEditor(hooks = {}) {
  onSave = hooks.onSave || (() => {});
  onMetaChange = hooks.onMetaChange || (() => {});

  els.badge = document.getElementById("status-badge");
  els.statusText = document.getElementById("status-text");
  els.yamlStatus = document.getElementById("yaml-status");
  els.checkYamlBtn = document.getElementById("check-yaml-btn");
  els.checkLabel = els.checkYamlBtn.querySelector(".check-label");
  els.editorCard = document.getElementById("editor-card");
  els.viewNodesBtn = document.getElementById("view-nodes-btn");
  els.viewYamlBtn = document.getElementById("view-yaml-btn");

  state.editor = CodeMirror.fromTextArea(document.getElementById("yaml-editor"), {
    mode: "yaml",
    theme: document.documentElement.dataset.theme === "light" ? "eclipse" : "material-darker",
    lineNumbers: true,
    indentUnit: 2,
    tabSize: 2,
    indentWithTabs: false,
    lineWrapping: true,
    gutters: ["CodeMirror-linenumbers", "yaml-error"],
    extraKeys: {
      Tab(cm) {
        if (cm.somethingSelected()) cm.indentSelection("add");
        else cm.replaceSelection("  ", "end");
      },
      "Ctrl-S"() {
        onSave();
        return false;
      },
      "Cmd-S"() {
        onSave();
        return false;
      },
    },
  });

  state.editor.on("changes", () => {
    if (!state.loadingFile && !state.syncingYaml && !state.previewVersion) {
      state.dirty = true;
      onMetaChange();
    }
    window.clearTimeout(state.validateTimer);
    state.validateTimer = window.setTimeout(validateEditorYaml, 250);
  });

  els.checkYamlBtn.addEventListener("click", () => {
    runYamlCheck();
  });
  els.viewNodesBtn.addEventListener("click", () => switchView("nodes"));
  els.viewYamlBtn.addEventListener("click", () => switchView("yaml"));
}
