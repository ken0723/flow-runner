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

let messages = {};
let currentLang = document.documentElement.lang === "en" ? "en" : "zh-Hant";
let yamlErrorMarker = null;
let validateTimer = 0;
let checkBusy = false;
let lastYamlResult = null;
let lastStatus = { state: "", key: "status.idle" };
let files = [];
let currentFile = null;
let dirty = false;
let loadingFile = false;
let saving = false;
let dialogResolver = null;

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
  updateFileMeta();
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

function updateFileMeta() {
  fileTitle.textContent = currentFile?.name || t("yaml.editorAria");
  fileDirtyEl.classList.toggle("hidden", !dirty);
  renderFileList();
}

function setEditorContent(content) {
  loadingFile = true;
  editor.setValue(content ?? "");
  loadingFile = false;
  dirty = false;
  updateFileMeta();
  validateEditorYaml();
  editor.setSize("100%", "100%");
  editor.refresh();
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
  if (currentFile?.id === id) return;

  if (!force && dirty) {
    const ok = await openDialog({
      title: t("files.unsavedTitle"),
      body: t("files.unsavedBody", { name: currentFile?.name || "" }),
      confirmLabel: t("files.discard"),
      cancelLabel: t("execute.cancel"),
      danger: true,
    });
    if (!ok) return;
  }

  const response = await fetch(`/api/files/${id}`);
  if (!response.ok) {
    setStatus("error", "files.loadFailed");
    return;
  }

  currentFile = await response.json();
  localStorage.setItem("currentFileId", String(currentFile.id));
  setEditorContent(currentFile.content);
}

async function saveCurrentFile() {
  if (!currentFile || saving) {
    if (!currentFile) await createFile();
    return;
  }

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
      body: JSON.stringify({ name: trimmed, content: "" }),
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
    currentFile = null;
    localStorage.removeItem("currentFileId");
    dirty = false;
  }

  await refreshFiles();
  if (!currentFile) {
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
  if (!loadingFile) {
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

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveCurrentFile();
  }
});

async function init() {
  applyTheme(currentTheme());
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
  window.addEventListener("resize", () => editor.refresh());
}

init();
