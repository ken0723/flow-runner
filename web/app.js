const LOCALES = {
  en: "/i18n/en.json",
  "zh-Hant": "/i18n/zh-Hant.json",
};

const badge = document.getElementById("status-badge");
const statusText = document.getElementById("status-text");
const yamlStatus = document.getElementById("yaml-status");
const checkYamlBtn = document.getElementById("check-yaml-btn");
const checkLabel = checkYamlBtn.querySelector(".check-label");
const executeBtn = document.getElementById("execute-btn");
const langBtn = document.getElementById("lang-btn");
const langBtnLabel = document.getElementById("lang-btn-label");
const langMenu = document.getElementById("lang-menu");
const themeBtn = document.getElementById("theme-btn");
const sunIcon = themeBtn.querySelector(".theme-icon-sun");
const moonIcon = themeBtn.querySelector(".theme-icon-moon");
const dialogBackdrop = document.getElementById("dialog-backdrop");
const dialogTitle = document.getElementById("dialog-title");
const dialogBody = document.getElementById("dialog-body");
const dialogInput = document.getElementById("dialog-input");
const dialogCancel = document.getElementById("dialog-cancel");
const dialogOk = document.getElementById("dialog-ok");
const fileListEl = document.getElementById("file-list");
const fileTitle = document.getElementById("file-title");
const fileDirtyEl = document.getElementById("file-dirty");
const newFileBtn = document.getElementById("new-file-btn");
const versionListEl = document.getElementById("version-list");
const previewBanner = document.getElementById("preview-banner");
const previewText = document.getElementById("preview-text");
const restoreBtn = document.getElementById("restore-btn");
const editorCard = document.getElementById("editor-card");
const viewNodesBtn = document.getElementById("view-nodes-btn");
const viewYamlBtn = document.getElementById("view-yaml-btn");

let messages = {};
let currentLang = document.documentElement.lang === "en" ? "en" : "zh-Hant";
let yamlErrorMarker = null;
let validateTimer = 0;
let checkBusy = false;
let lastYamlResult = null;
let lastStatus = { state: "", key: "status.idle" };
let files = [];
let versions = [];
let currentFile = null;
let previewVersion = null;
let dirty = false;
let loadingFile = false;
let saving = false;
let dialogResolver = null;
let viewMode = localStorage.getItem("editorView") === "yaml" ? "yaml" : "nodes";
let flowCanvas = null;
let syncingYaml = false;

const editor = CodeMirror.fromTextArea(document.getElementById("yaml-editor"), {
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
    "Ctrl-S"(cm) {
      saveCurrentFile();
      return false;
    },
    "Cmd-S"(cm) {
      saveCurrentFile();
      return false;
    },
  },
});

function t(key, vars = {}) {
  const value = key.split(".").reduce((obj, part) => obj?.[part], messages);
  let text = typeof value === "string" ? value : key;
  for (const [name, replacement] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(replacement));
  }
  return text;
}

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });
  document.title = t("app.title");
  langBtnLabel.textContent = currentLang === "en" ? "EN" : "繁";
  langMenu.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.setAttribute("aria-selected", btn.dataset.lang === currentLang ? "true" : "false");
  });
  updateThemeButton();
  if (checkBusy) checkLabel.textContent = t("yaml.checkingBtn");
  setStatus(lastStatus.state, lastStatus.key);
  if (lastYamlResult) setYamlStatus(lastYamlResult);
  renderFileList();
  renderVersionList();
  updateFileMeta();
  updateViewButtons();
  flowCanvas?.refresh();
}

async function setLanguage(lang) {
  const next = LOCALES[lang] ? lang : "zh-Hant";
  const response = await fetch(LOCALES[next]);
  messages = await response.json();
  currentLang = next;
  localStorage.setItem("lang", next);
  document.documentElement.lang = next;
  applyTranslations();
}

function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function updateThemeButton() {
  const light = currentTheme() === "light";
  sunIcon.classList.toggle("hidden", light);
  moonIcon.classList.toggle("hidden", !light);
  themeBtn.setAttribute("aria-label", t(light ? "theme.toDark" : "theme.toLight"));
}

function applyTheme(theme) {
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
  editor.setOption("theme", next === "light" ? "eclipse" : "material-darker");
  updateThemeButton();
}

function setStatus(state, key) {
  lastStatus = { state, key };
  badge.className = `badge ${state}`.trim();
  statusText.textContent = t(key);
}

function checkYamlSyntax(yamlText) {
  try {
    jsyaml.load(yamlText ?? "");
    return { valid: true, error: null };
  } catch (err) {
    const mark = err.mark;
    return {
      valid: false,
      error: {
        message: err.reason || err.message || "Invalid YAML",
        line: typeof mark?.line === "number" ? mark.line + 1 : null,
        column: typeof mark?.column === "number" ? mark.column + 1 : null,
      },
    };
  }
}

function makeErrorMarker() {
  const marker = document.createElement("span");
  marker.className = "yaml-error-gutter";
  marker.title = t("yaml.errorMarker");
  marker.textContent = "●";
  return marker;
}

function setYamlStatus(result) {
  lastYamlResult = result;
  yamlStatus.classList.remove("ok", "error");
  editor.clearGutter("yaml-error");
  if (yamlErrorMarker) {
    yamlErrorMarker.clear();
    yamlErrorMarker = null;
  }

  if (result.valid) {
    yamlStatus.classList.add("ok");
    yamlStatus.textContent = t("yaml.valid");
    if (!dirty) setStatus("done", "status.valid");
    return;
  }

  const { message, line, column } = result.error;
  const where =
    line != null
      ? column != null
        ? t("yaml.whereLineCol", { line, column })
        : t("yaml.whereLine", { line })
      : "YAML";

  yamlStatus.classList.add("error");
  yamlStatus.textContent = t("yaml.error", { where, message });
  setStatus("error", "status.invalid");

  if (line == null) return;

  const lineIndex = line - 1;
  const lineText = editor.getLine(lineIndex) ?? "";
  const startCh = Math.max(0, (column ?? 1) - 1);

  editor.setGutterMarker(lineIndex, "yaml-error", makeErrorMarker());
  yamlErrorMarker = editor.markText(
    { line: lineIndex, ch: startCh },
    { line: lineIndex, ch: lineText.length },
    { className: "yaml-error-text" }
  );
}

function validateEditorYaml() {
  const result = checkYamlSyntax(editor.getValue());
  setYamlStatus(result);
  return result;
}

async function runYamlCheck() {
  if (checkBusy) return;
  checkBusy = true;
  checkYamlBtn.classList.add("checking");
  checkYamlBtn.disabled = true;
  checkLabel.textContent = t("yaml.checkingBtn");
  yamlStatus.classList.remove("ok", "error");
  yamlStatus.textContent = t("yaml.checking");
  setStatus("running", "status.checking");

  await new Promise((resolve) => window.setTimeout(resolve, 450));
  validateEditorYaml();

  checkYamlBtn.classList.remove("checking");
  checkYamlBtn.disabled = false;
  checkLabel.textContent = t("yaml.check");
  checkBusy = false;
}

function isLangMenuOpen() {
  return !langMenu.classList.contains("hidden");
}

function setLangMenuOpen(open) {
  langMenu.classList.toggle("hidden", !open);
  langBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

function isDialogOpen() {
  return !dialogBackdrop.classList.contains("hidden");
}

function closeDialog(result) {
  if (!isDialogOpen()) return;
  dialogBackdrop.classList.add("hidden");
  dialogInput.classList.add("hidden");
  dialogOk.classList.remove("danger");
  const resolve = dialogResolver;
  dialogResolver = null;
  resolve?.(result);
}

function openDialog({ title, body, confirmLabel, cancelLabel, input, danger }) {
  if (isDialogOpen()) closeDialog(null);

  return new Promise((resolve) => {
    dialogResolver = resolve;
    dialogTitle.textContent = title;
    dialogBody.textContent = body;
    dialogOk.textContent = confirmLabel;
    dialogCancel.textContent = cancelLabel;
    dialogOk.classList.toggle("danger", Boolean(danger));

    if (input) {
      dialogInput.classList.remove("hidden");
      dialogInput.value = input.value ?? "";
      dialogInput.placeholder = input.placeholder ?? "";
    } else {
      dialogInput.classList.add("hidden");
      dialogInput.value = "";
    }

    dialogBackdrop.classList.remove("hidden");
    window.setTimeout(() => {
      if (input) dialogInput.focus();
      else dialogOk.focus();
    }, 0);
  });
}

function executePipeline() {
  // TODO: connect to /api/run
}

function starterGraph() {
  return {
    nodes: [
      { id: "start_1", type: "start", name: "pipeline", x: 72, y: 180 },
      { id: "command_1", type: "command", command: "echo hello", x: 360, y: 180 },
      { id: "end_1", type: "end", echo: "done", x: 648, y: 180 },
    ],
    edges: [
      { from: "start_1", to: "command_1" },
      { from: "command_1", to: "end_1" },
    ],
  };
}

function graphToYaml(graph) {
  const start = (graph.nodes || []).find((node) => node.type === "start");
  const doc = {
    name: String(start?.name || "").trim() || "pipeline",
    nodes: (graph.nodes || []).map((node) => {
      const item = {
        id: node.id,
        type: node.type,
        x: Math.round(Number(node.x) || 0),
        y: Math.round(Number(node.y) || 0),
      };
      if (node.type === "start") item.name = node.name ?? "";
      if (node.type === "command") item.command = node.command ?? "";
      if (node.type === "end") item.echo = "done";
      return item;
    }),
    edges: (graph.edges || []).map((edge) => ({ from: edge.from, to: edge.to })),
  };
  return jsyaml.dump(doc, { indent: 2, lineWidth: 120, noRefs: true });
}

function yamlToGraph(text, previous = { nodes: [] }) {
  let doc;
  try {
    doc = jsyaml.load(text ?? "");
  } catch {
    return { nodes: [], edges: [] };
  }

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { nodes: [], edges: [] };
  }

  const prevById = new Map((previous.nodes || []).map((node) => [node.id, node]));
  const nodesIn = Array.isArray(doc.nodes) ? doc.nodes : [];
  const nodes = [];
  const usedIds = new Set();

  for (const raw of nodesIn) {
    if (!raw || typeof raw !== "object") continue;
    const type = raw.type === "start" || raw.type === "command" || raw.type === "end" ? raw.type : null;
    if (!type) continue;

    let id = String(raw.id || "").trim() || `${type}_${nodes.length + 1}`;
    if (usedIds.has(id)) id = `${id}_${nodes.length + 1}`;
    usedIds.add(id);

    const prev = prevById.get(id);
    const node = {
      id,
      type,
      x: Number.isFinite(Number(raw.x))
        ? Number(raw.x)
        : Number.isFinite(prev?.x)
          ? prev.x
          : 72 + nodes.length * 288,
      y: Number.isFinite(Number(raw.y))
        ? Number(raw.y)
        : Number.isFinite(prev?.y)
          ? prev.y
          : 180,
    };
    if (type === "start") node.name = String(raw.name ?? doc.name ?? "");
    if (type === "command") node.command = String(raw.command ?? "");
    if (type === "end") node.echo = "done";
    nodes.push(node);
  }

  const ids = new Set(nodes.map((node) => node.id));
  const edges = [];
  for (const raw of Array.isArray(doc.edges) ? doc.edges : []) {
    if (!raw || typeof raw !== "object") continue;
    const from = String(raw.from || "");
    const to = String(raw.to || "");
    if (!ids.has(from) || !ids.has(to) || from === to) continue;
    if (edges.some((edge) => edge.from === from && edge.to === to)) continue;
    edges.push({ from, to });
  }

  return { nodes, edges };
}

function writeYamlFromGraph() {
  if (!flowCanvas) return;
  syncingYaml = true;
  editor.setValue(graphToYaml(flowCanvas.getGraph()));
  syncingYaml = false;
  validateEditorYaml();
}

function loadGraphFromYaml(content, { preservePositions = false, resetHistory = true } = {}) {
  const previous = preservePositions ? flowCanvas?.getGraph() : { nodes: [] };
  flowCanvas?.setGraph(yamlToGraph(content ?? "", previous), { resetHistory });
}

function updateViewButtons() {
  viewNodesBtn.classList.toggle("is-active", viewMode === "nodes");
  viewYamlBtn.classList.toggle("is-active", viewMode === "yaml");
  viewNodesBtn.setAttribute("aria-selected", viewMode === "nodes" ? "true" : "false");
  viewYamlBtn.setAttribute("aria-selected", viewMode === "yaml" ? "true" : "false");
}

function applyView(mode) {
  viewMode = mode === "yaml" ? "yaml" : "nodes";
  localStorage.setItem("editorView", viewMode);
  editorCard.dataset.view = viewMode;
  document.querySelector(".workspace").dataset.view = viewMode;
  updateViewButtons();
  if (viewMode === "yaml") {
    window.requestAnimationFrame(() => {
      editor.setSize("100%", "100%");
      editor.refresh();
    });
  }
}

function switchView(mode) {
  const next = mode === "yaml" ? "yaml" : "nodes";
  if (next === viewMode) return;

  if (next === "nodes") {
    const result = validateEditorYaml();
    if (!result.valid) {
      yamlStatus.textContent = t("view.invalidYaml");
      return;
    }
    loadGraphFromYaml(editor.getValue(), { preservePositions: true });
  } else if ((flowCanvas?.getGraph()?.nodes || []).length) {
    writeYamlFromGraph();
  }

  applyView(next);
}

function updateFileMeta() {
  if (previewVersion) {
    fileTitle.textContent = previewVersion.name;
    previewText.textContent = t("files.previewing", { name: previewVersion.name });
    previewBanner.classList.remove("hidden");
    fileDirtyEl.classList.add("hidden");
  } else {
    fileTitle.textContent = currentFile?.name || t("yaml.editorAria");
    previewBanner.classList.add("hidden");
    fileDirtyEl.classList.toggle("hidden", !dirty);
  }
  renderFileList();
  renderVersionList();
}

function setEditorContent(content) {
  loadingFile = true;
  editor.setValue(content ?? "");
  loadingFile = false;
  dirty = false;
  loadGraphFromYaml(content ?? "");
  if ((flowCanvas?.getGraph()?.nodes || []).length) {
    const normalized = graphToYaml(flowCanvas.getGraph());
    if (normalized !== editor.getValue()) {
      loadingFile = true;
      editor.setValue(normalized);
      loadingFile = false;
    }
  }
  updateFileMeta();
  validateEditorYaml();
  editor.setSize("100%", "100%");
  editor.refresh();
}

function renderVersionList() {
  versionListEl.replaceChildren();

  if (!currentFile || !versions.length) {
    const empty = document.createElement("p");
    empty.className = "file-empty";
    empty.textContent = t("files.historyEmpty");
    versionListEl.appendChild(empty);
    return;
  }

  for (const version of versions) {
    const row = document.createElement("div");
    row.className = "file-item";
    if (previewVersion?.id === version.id) row.classList.add("previewing");

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "file-item-open";
    openBtn.textContent = version.name;
    openBtn.title = version.name;
    openBtn.addEventListener("click", () => previewSnapshot(version));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "file-item-delete";
    delBtn.textContent = "×";
    delBtn.setAttribute("aria-label", t("files.deleteSnapshot"));
    delBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteSnapshot(version);
    });

    row.append(openBtn, delBtn);
    versionListEl.appendChild(row);
  }
}

async function refreshVersions() {
  if (!currentFile) {
    versions = [];
    renderVersionList();
    return;
  }

  const response = await fetch(`/api/files/${currentFile.id}/versions`);
  if (!response.ok) {
    versions = [];
    renderVersionList();
    return;
  }
  versions = await response.json();
  renderVersionList();
}

function setPreviewMode(on) {
  editor.setOption("readOnly", on ? "nocursor" : false);
  editorCard.classList.toggle("is-preview", on);
}

function exitPreview() {
  previewVersion = null;
  setPreviewMode(false);
}

async function previewSnapshot(version) {
  if (!currentFile) return;
  const response = await fetch(`/api/files/${currentFile.id}/versions/${version.id}`);
  if (!response.ok) {
    setStatus("error", "files.loadFailed");
    return;
  }

  previewVersion = await response.json();
  setPreviewMode(true);
  loadingFile = true;
  editor.setValue(previewVersion.content ?? "");
  loadingFile = false;
  dirty = false;
  loadGraphFromYaml(previewVersion.content ?? "");
  updateFileMeta();
  validateEditorYaml();
  editor.setSize("100%", "100%");
  editor.refresh();
}

async function restoreSnapshot() {
  if (!currentFile || !previewVersion) return;

  const ok = await openDialog({
    title: t("files.restoreTitle"),
    body: t("files.restoreBody", { name: previewVersion.name }),
    confirmLabel: t("files.restore"),
    cancelLabel: t("execute.cancel"),
  });
  if (!ok) return;

  const response = await fetch(`/api/files/${currentFile.id}/rollback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ versionId: previewVersion.id }),
  });
  if (!response.ok) {
    setStatus("error", "files.saveFailed");
    return;
  }

  currentFile = await response.json();
  exitPreview();
  setEditorContent(currentFile.content);
  setStatus("done", "status.saved");
  await refreshFiles();
  await refreshVersions();
}

async function deleteSnapshot(version) {
  if (!currentFile) return;

  const ok = await openDialog({
    title: t("files.deleteSnapshotTitle"),
    body: t("files.deleteSnapshotBody", { name: version.name }),
    confirmLabel: t("files.deleteSnapshot"),
    cancelLabel: t("execute.cancel"),
    danger: true,
  });
  if (!ok) return;

  const response = await fetch(`/api/files/${currentFile.id}/versions/${version.id}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    setStatus("error", "files.saveFailed");
    return;
  }

  if (previewVersion?.id === version.id) {
    exitPreview();
    if (currentFile) {
      const reload = await fetch(`/api/files/${currentFile.id}`);
      if (reload.ok) {
        currentFile = await reload.json();
        setEditorContent(currentFile.content);
      }
    }
  }

  await refreshVersions();
}

function renderFileList() {
  fileListEl.replaceChildren();

  if (!files.length) {
    const empty = document.createElement("p");
    empty.className = "file-empty";
    empty.textContent = t("files.empty");
    fileListEl.appendChild(empty);
    return;
  }

  for (const file of files) {
    const row = document.createElement("div");
    row.className = "file-item";
    if (currentFile?.id === file.id) row.classList.add("active");
    if (currentFile?.id === file.id && dirty) row.classList.add("dirty");

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "file-item-open";
    openBtn.textContent = file.name;
    openBtn.addEventListener("click", () => selectFile(file.id));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "file-item-delete";
    delBtn.textContent = "×";
    delBtn.setAttribute("aria-label", t("files.delete"));
    delBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteFile(file);
    });

    row.append(openBtn, delBtn);
    fileListEl.appendChild(row);
  }
}

async function refreshFiles() {
  const response = await fetch("/api/files");
  if (!response.ok) throw new Error(t("files.loadFailed"));
  files = await response.json();
  renderFileList();
}

async function selectFile(id, { force = false } = {}) {
  if (currentFile?.id === id && !previewVersion) return;

  if (currentFile?.id === id && previewVersion) {
    exitPreview();
    const response = await fetch(`/api/files/${id}`);
    if (!response.ok) {
      setStatus("error", "files.loadFailed");
      return;
    }
    currentFile = await response.json();
    setEditorContent(currentFile.content);
    await refreshVersions();
    return;
  }

  if (!force && dirty && !previewVersion) {
    const ok = await openDialog({
      title: t("files.unsavedTitle"),
      body: t("files.unsavedBody", { name: currentFile?.name || "" }),
      confirmLabel: t("files.discard"),
      cancelLabel: t("execute.cancel"),
      danger: true,
    });
    if (!ok) return;
  }

  exitPreview();

  const response = await fetch(`/api/files/${id}`);
  if (!response.ok) {
    setStatus("error", "files.loadFailed");
    return;
  }

  currentFile = await response.json();
  localStorage.setItem("currentFileId", String(currentFile.id));
  setEditorContent(currentFile.content);
  await refreshVersions();
}

async function saveCurrentFile() {
  if (previewVersion) return;
  if (!currentFile || saving) {
    if (!currentFile) await createFile();
    return;
  }

  if (viewMode === "nodes") writeYamlFromGraph();

  saving = true;
  try {
    const response = await fetch(`/api/files/${currentFile.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editor.getValue() }),
    });
    if (!response.ok) throw new Error(t("files.saveFailed"));
    currentFile = await response.json();
    dirty = false;
    updateFileMeta();
    setStatus("done", "status.saved");
    await refreshFiles();
    await refreshVersions();
  } catch {
    setStatus("error", "files.saveFailed");
  } finally {
    saving = false;
  }
}

async function createFile() {
  if (dirty) {
    const ok = await openDialog({
      title: t("files.unsavedTitle"),
      body: t("files.unsavedBody", { name: currentFile?.name || "" }),
      confirmLabel: t("files.discard"),
      cancelLabel: t("execute.cancel"),
      danger: true,
    });
    if (!ok) return;
    dirty = false;
  }

  const name = await openDialog({
    title: t("files.newTitle"),
    body: t("files.newBody"),
    confirmLabel: t("files.create"),
    cancelLabel: t("execute.cancel"),
    input: { value: "", placeholder: t("files.namePlaceholder") },
  });
  if (typeof name !== "string") return;

  const trimmed = name.trim();
  if (!trimmed) return;

  try {
    const response = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed, content: graphToYaml(starterGraph()) }),
    });
    if (response.status === 409) {
      setStatus("error", "files.nameExists");
      return;
    }
    if (response.status === 400) {
      setStatus("error", "files.nameInvalid");
      return;
    }
    if (!response.ok) throw new Error(t("files.saveFailed"));
    const created = await response.json();
    await refreshFiles();
    await selectFile(created.id, { force: true });
  } catch {
    setStatus("error", "files.saveFailed");
  }
}

async function deleteFile(file) {
  const ok = await openDialog({
    title: t("files.deleteTitle"),
    body: t("files.deleteBody", { name: file.name }),
    confirmLabel: t("files.delete"),
    cancelLabel: t("execute.cancel"),
    danger: true,
  });
  if (!ok) return;

  const response = await fetch(`/api/files/${file.id}`, { method: "DELETE" });
  if (!response.ok) {
    setStatus("error", "files.saveFailed");
    return;
  }

  if (currentFile?.id === file.id) {
    exitPreview();
    currentFile = null;
    versions = [];
    localStorage.removeItem("currentFileId");
    dirty = false;
  }

  await refreshFiles();
  if (!currentFile) {
    renderVersionList();
    if (files[0]) await selectFile(files[0].id, { force: true });
    else setEditorContent("");
  }
}

async function loadInitialFile() {
  await refreshFiles();
  const savedId = Number(localStorage.getItem("currentFileId"));
  const match = files.find((file) => file.id === savedId) || files[0];
  if (match) await selectFile(match.id, { force: true });
  else setEditorContent("");
}

editor.on("changes", () => {
  if (!loadingFile && !syncingYaml && !previewVersion) {
    dirty = true;
    updateFileMeta();
  }
  window.clearTimeout(validateTimer);
  validateTimer = window.setTimeout(validateEditorYaml, 250);
});

checkYamlBtn.addEventListener("click", () => {
  runYamlCheck();
});

newFileBtn.addEventListener("click", () => {
  createFile();
});

restoreBtn.addEventListener("click", () => {
  restoreSnapshot();
});

viewNodesBtn.addEventListener("click", () => switchView("nodes"));
viewYamlBtn.addEventListener("click", () => switchView("yaml"));

executeBtn.addEventListener("click", async () => {
  const ok = await openDialog({
    title: t("execute.confirmTitle"),
    body: t("execute.confirmBody"),
    confirmLabel: t("execute.confirm"),
    cancelLabel: t("execute.cancel"),
  });
  if (ok) executePipeline();
});

dialogCancel.addEventListener("click", () => {
  closeDialog(null);
});

dialogOk.addEventListener("click", () => {
  if (!dialogInput.classList.contains("hidden")) closeDialog(dialogInput.value);
  else closeDialog(true);
});

dialogInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    closeDialog(dialogInput.value);
  }
});

dialogBackdrop.addEventListener("click", (event) => {
  if (event.target === dialogBackdrop) closeDialog(null);
});

themeBtn.addEventListener("click", () => {
  applyTheme(currentTheme() === "light" ? "dark" : "light");
});

langBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  setLangMenuOpen(!isLangMenuOpen());
});

langMenu.addEventListener("click", (event) => {
  const button = event.target.closest("[data-lang]");
  if (!button) return;
  setLangMenuOpen(false);
  setLanguage(button.dataset.lang);
});

document.addEventListener("click", () => {
  setLangMenuOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeDialog(null);
    setLangMenuOpen(false);
    return;
  }

  if (isDialogOpen()) return;

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveCurrentFile();
    return;
  }

  if (viewMode !== "nodes") return;

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) flowCanvas?.redo();
    else flowCanvas?.undo();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    flowCanvas?.redo();
    return;
  }

  if (event.key === "Delete" || event.key === "Backspace") {
    if (event.target.closest("input, textarea, .CodeMirror")) return;
    if (flowCanvas?.deleteSelection()) event.preventDefault();
  }
}, true);

function setupSplitters() {
  const workspace = document.querySelector(".workspace");
  const explorer = document.querySelector(".file-explorer");
  const history = document.getElementById("history-panel");
  const nodePanel = document.getElementById("node-panel");
  const explorerSash = document.getElementById("explorer-sash");
  const historySash = document.getElementById("history-sash");
  const paletteSash = document.getElementById("palette-sash");
  const MIN_EXPLORER = 180;
  const MIN_EDITOR = 280;
  const MIN_PALETTE = 92;
  const MIN_FILES = 88;
  const MIN_HISTORY = 88;

  const savedWidth = Number(localStorage.getItem("explorerWidth"));
  if (Number.isFinite(savedWidth) && savedWidth >= MIN_EXPLORER) {
    explorer.style.width = `${savedWidth}px`;
  }
  const savedHeight = Number(localStorage.getItem("historyHeight"));
  if (Number.isFinite(savedHeight) && savedHeight >= MIN_HISTORY) {
    history.style.height = `${savedHeight}px`;
  }
  const savedPalette = Number(localStorage.getItem("paletteWidth"));
  if (Number.isFinite(savedPalette) && savedPalette >= MIN_PALETTE) {
    nodePanel.style.width = `${savedPalette}px`;
  }

  function paletteVisible() {
    return workspace.dataset.view !== "yaml";
  }

  function paletteOccupied() {
    if (!paletteVisible()) return 0;
    return (
      nodePanel.getBoundingClientRect().width +
      paletteSash.getBoundingClientRect().width
    );
  }

  function bindSash(sash, axis, onMove) {
    sash.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      sash.classList.add("is-active");
      document.body.classList.add(axis === "x" ? "is-resizing-ew" : "is-resizing-ns");
      sash.setPointerCapture(event.pointerId);

      const move = (ev) => onMove(ev);
      const up = () => {
        sash.classList.remove("is-active");
        document.body.classList.remove("is-resizing-ew", "is-resizing-ns");
        sash.removeEventListener("pointermove", move);
        sash.removeEventListener("pointerup", up);
        editor.refresh();
      };
      sash.addEventListener("pointermove", move);
      sash.addEventListener("pointerup", up);
    });
  }

  bindSash(explorerSash, "x", (event) => {
    const bounds = workspace.getBoundingClientRect();
    const sashWidth = explorerSash.getBoundingClientRect().width;
    const maxWidth = bounds.width - MIN_EDITOR - sashWidth - paletteOccupied();
    const next = Math.min(maxWidth, Math.max(MIN_EXPLORER, event.clientX - bounds.left));
    explorer.style.width = `${next}px`;
    localStorage.setItem("explorerWidth", String(Math.round(next)));
  });

  bindSash(paletteSash, "x", (event) => {
    const bounds = workspace.getBoundingClientRect();
    const sashWidth = paletteSash.getBoundingClientRect().width;
    const explorerW = explorer.getBoundingClientRect().width;
    const explorerSashW = explorerSash.getBoundingClientRect().width;
    const maxWidth = bounds.width - explorerW - explorerSashW - MIN_EDITOR - sashWidth;
    const next = Math.min(maxWidth, Math.max(MIN_PALETTE, bounds.right - event.clientX));
    nodePanel.style.width = `${next}px`;
    localStorage.setItem("paletteWidth", String(Math.round(next)));
  });

  bindSash(historySash, "y", (event) => {
    const bounds = explorer.getBoundingClientRect();
    const sashHeight = historySash.getBoundingClientRect().height;
    const fileBar = explorer.querySelector(".explorer-bar");
    const fileBarH = fileBar ? fileBar.getBoundingClientRect().height : 44;
    const maxHeight = Math.max(
      MIN_HISTORY,
      bounds.height - MIN_FILES - sashHeight - fileBarH
    );
    const next = Math.min(maxHeight, Math.max(MIN_HISTORY, bounds.bottom - event.clientY));
    history.style.height = `${next}px`;
    localStorage.setItem("historyHeight", String(Math.round(next)));
  });
}

async function init() {
  applyTheme(currentTheme());
  flowCanvas = FlowCanvas.create({
    el: document.getElementById("flow-canvas"),
    t,
    onChange() {
      if (previewVersion) return;
      const next = graphToYaml(flowCanvas.getGraph());
      if (next === editor.getValue()) return;
      writeYamlFromGraph();
      dirty = true;
      updateFileMeta();
    },
  });
  const nodePanel = document.getElementById("node-panel");
  const palette = document.querySelector("#flow-canvas .flow-palette");
  if (nodePanel && palette) nodePanel.appendChild(palette);
  applyView(viewMode);
  try {
    await setLanguage(currentLang);
  } catch {
    messages = {};
  }
  try {
    await loadInitialFile();
  } catch {
    setStatus("error", "files.loadFailed");
    validateEditorYaml();
  }
  editor.setSize("100%", "100%");
  setupSplitters();
  window.addEventListener("resize", () => editor.refresh());
}

init();
