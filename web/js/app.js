import { state } from "./state.js";
import { t, setLanguage, onI18nChange } from "./i18n.js";
import { applyTheme, toggleTheme, updateThemeButton } from "./theme.js";
import { initDialog, openDialog, closeDialog, isDialogOpen } from "./dialog.js";
import { graphToYaml } from "./yaml.js";
import { create as createFlowCanvas } from "./canvas/flow-canvas.js";
import { setupSplitters } from "./splitters.js";
import {
  initEditor,
  applyView,
  setStatus,
  validateEditorYaml,
  writeYamlFromGraph,
  refreshEditorI18n,
} from "./editor.js";
import {
  initFiles,
  updateFileMeta,
  saveCurrentFile,
  loadInitialFile,
} from "./files.js";

function executePipeline() {
  // TODO: connect to /api/run
}

function isLangMenuOpen() {
  return !document.getElementById("lang-menu").classList.contains("hidden");
}

function setLangMenuOpen(open) {
  const langMenu = document.getElementById("lang-menu");
  const langBtn = document.getElementById("lang-btn");
  langMenu.classList.toggle("hidden", !open);
  langBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

function bindChrome() {
  const executeBtn = document.getElementById("execute-btn");
  const langBtn = document.getElementById("lang-btn");
  const langMenu = document.getElementById("lang-menu");
  const themeBtn = document.getElementById("theme-btn");

  executeBtn.addEventListener("click", async () => {
    const ok = await openDialog({
      title: t("execute.confirmTitle"),
      body: t("execute.confirmBody"),
      confirmLabel: t("execute.confirm"),
      cancelLabel: t("execute.cancel"),
    });
    if (ok) executePipeline();
  });

  themeBtn.addEventListener("click", () => {
    toggleTheme();
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

    if (state.viewMode !== "nodes") return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) state.flowCanvas?.redo();
      else state.flowCanvas?.undo();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      state.flowCanvas?.redo();
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      if (event.target.closest("input, textarea, .CodeMirror")) return;
      if (state.flowCanvas?.deleteSelection()) event.preventDefault();
    }
  }, true);
}

async function init() {
  initDialog();
  initFiles();
  initEditor({
    onSave: () => saveCurrentFile(),
    onMetaChange: () => updateFileMeta(),
  });

  onI18nChange(() => {
    updateThemeButton();
    refreshEditorI18n();
    updateFileMeta();
    state.flowCanvas?.refresh();
  });

  applyTheme(document.documentElement.dataset.theme);
  state.flowCanvas = createFlowCanvas({
    el: document.getElementById("flow-canvas"),
    t,
    onChange() {
      if (state.previewVersion) return;
      const next = graphToYaml(state.flowCanvas.getGraph());
      if (next === state.editor.getValue()) return;
      writeYamlFromGraph();
      state.dirty = true;
      updateFileMeta();
    },
  });

  const nodePanel = document.getElementById("node-panel");
  const palette = document.querySelector("#flow-canvas .flow-palette");
  if (nodePanel && palette) nodePanel.appendChild(palette);

  applyView(state.viewMode);

  bindChrome();

  try {
    await setLanguage(state.currentLang);
  } catch {
    state.messages = {};
  }
  try {
    await loadInitialFile();
  } catch {
    setStatus("error", "files.loadFailed");
    validateEditorYaml();
  }
  state.editor.setSize("100%", "100%");
  setupSplitters(state.editor);
  window.addEventListener("resize", () => state.editor.refresh());
}

init();
