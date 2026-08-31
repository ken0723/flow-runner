import { state } from "./state.js";
import { t } from "./i18n.js";
import { openDialog } from "./dialog.js";
import { starterGraph, graphToYaml } from "./yaml.js";
import {
  setStatus,
  setEditorContent,
  writeYamlFromGraph,
  loadGraphFromYaml,
  setPreviewMode,
  validateEditorYaml,
} from "./editor.js";
import * as api from "./api.js";

const els = {};

export function initFiles() {
  els.fileList = document.getElementById("file-list");
  els.fileTitle = document.getElementById("file-title");
  els.fileDirty = document.getElementById("file-dirty");
  els.newFileBtn = document.getElementById("new-file-btn");
  els.versionList = document.getElementById("version-list");
  els.previewBanner = document.getElementById("preview-banner");
  els.previewText = document.getElementById("preview-text");
  els.restoreBtn = document.getElementById("restore-btn");

  els.newFileBtn.addEventListener("click", () => {
    createFile();
  });
  els.restoreBtn.addEventListener("click", () => {
    restoreSnapshot();
  });
}

export function updateFileMeta() {
  if (state.previewVersion) {
    els.fileTitle.textContent = state.previewVersion.name;
    els.previewText.textContent = t("files.previewing", { name: state.previewVersion.name });
    els.previewBanner.classList.remove("hidden");
    els.fileDirty.classList.add("hidden");
  } else {
    els.fileTitle.textContent = state.currentFile?.name || t("yaml.editorAria");
    els.previewBanner.classList.add("hidden");
    els.fileDirty.classList.toggle("hidden", !state.dirty);
  }
  renderFileList();
  renderVersionList();
}

export function renderVersionList() {
  els.versionList.replaceChildren();

  if (!state.currentFile || !state.versions.length) {
    const empty = document.createElement("p");
    empty.className = "file-empty";
    empty.textContent = t("files.historyEmpty");
    els.versionList.appendChild(empty);
    return;
  }

  for (const version of state.versions) {
    const row = document.createElement("div");
    row.className = "file-item";
    if (state.previewVersion?.id === version.id) row.classList.add("previewing");

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
    els.versionList.appendChild(row);
  }
}

export async function refreshVersions() {
  if (!state.currentFile) {
    state.versions = [];
    renderVersionList();
    return;
  }

  const response = await api.listVersions(state.currentFile.id);
  if (!response.ok) {
    state.versions = [];
    renderVersionList();
    return;
  }
  state.versions = await response.json();
  renderVersionList();
}

export function exitPreview() {
  state.previewVersion = null;
  setPreviewMode(false);
}

async function previewSnapshot(version) {
  if (!state.currentFile) return;
  const response = await api.getVersion(state.currentFile.id, version.id);
  if (!response.ok) {
    setStatus("error", "files.loadFailed");
    return;
  }

  state.previewVersion = await response.json();
  setPreviewMode(true);
  state.loadingFile = true;
  state.editor.setValue(state.previewVersion.content ?? "");
  state.loadingFile = false;
  state.dirty = false;
  loadGraphFromYaml(state.previewVersion.content ?? "");
  updateFileMeta();
  validateEditorYaml();
  state.editor.setSize("100%", "100%");
  state.editor.refresh();
}

async function restoreSnapshot() {
  if (!state.currentFile || !state.previewVersion) return;

  const ok = await openDialog({
    title: t("files.restoreTitle"),
    body: t("files.restoreBody", { name: state.previewVersion.name }),
    confirmLabel: t("files.restore"),
    cancelLabel: t("execute.cancel"),
  });
  if (!ok) return;

  const response = await api.rollbackFile(state.currentFile.id, state.previewVersion.id);
  if (!response.ok) {
    setStatus("error", "files.saveFailed");
    return;
  }

  state.currentFile = await response.json();
  exitPreview();
  setEditorContent(state.currentFile.content);
  setStatus("done", "status.saved");
  await refreshFiles();
  await refreshVersions();
}

async function deleteSnapshot(version) {
  if (!state.currentFile) return;

  const ok = await openDialog({
    title: t("files.deleteSnapshotTitle"),
    body: t("files.deleteSnapshotBody", { name: version.name }),
    confirmLabel: t("files.deleteSnapshot"),
    cancelLabel: t("execute.cancel"),
    danger: true,
  });
  if (!ok) return;

  const response = await api.deleteVersion(state.currentFile.id, version.id);
  if (!response.ok) {
    setStatus("error", "files.saveFailed");
    return;
  }

  if (state.previewVersion?.id === version.id) {
    exitPreview();
    if (state.currentFile) {
      const reload = await api.getFile(state.currentFile.id);
      if (reload.ok) {
        state.currentFile = await reload.json();
        setEditorContent(state.currentFile.content);
      }
    }
  }

  await refreshVersions();
}

export function renderFileList() {
  els.fileList.replaceChildren();

  if (!state.files.length) {
    const empty = document.createElement("p");
    empty.className = "file-empty";
    empty.textContent = t("files.empty");
    els.fileList.appendChild(empty);
    return;
  }

  for (const file of state.files) {
    const row = document.createElement("div");
    row.className = "file-item";
    if (state.currentFile?.id === file.id) row.classList.add("active");
    if (state.currentFile?.id === file.id && state.dirty) row.classList.add("dirty");

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
    els.fileList.appendChild(row);
  }
}

export async function refreshFiles() {
  const response = await api.listFiles();
  if (!response.ok) throw new Error(t("files.loadFailed"));
  state.files = await response.json();
  renderFileList();
}

export async function selectFile(id, { force = false } = {}) {
  if (state.currentFile?.id === id && !state.previewVersion) return;

  if (state.currentFile?.id === id && state.previewVersion) {
    exitPreview();
    const response = await api.getFile(id);
    if (!response.ok) {
      setStatus("error", "files.loadFailed");
      return;
    }
    state.currentFile = await response.json();
    setEditorContent(state.currentFile.content);
    await refreshVersions();
    return;
  }

  if (!force && state.dirty && !state.previewVersion) {
    const ok = await openDialog({
      title: t("files.unsavedTitle"),
      body: t("files.unsavedBody", { name: state.currentFile?.name || "" }),
      confirmLabel: t("files.discard"),
      cancelLabel: t("execute.cancel"),
      danger: true,
    });
    if (!ok) return;
  }

  exitPreview();

  const response = await api.getFile(id);
  if (!response.ok) {
    setStatus("error", "files.loadFailed");
    return;
  }

  state.currentFile = await response.json();
  localStorage.setItem("currentFileId", String(state.currentFile.id));
  setEditorContent(state.currentFile.content);
  await refreshVersions();
}

export async function saveCurrentFile() {
  if (state.previewVersion) return;
  if (!state.currentFile || state.saving) {
    if (!state.currentFile) await createFile();
    return;
  }

  if (state.viewMode === "nodes") writeYamlFromGraph();

  state.saving = true;
  try {
    const response = await api.updateFile(state.currentFile.id, state.editor.getValue());
    if (!response.ok) throw new Error(t("files.saveFailed"));
    state.currentFile = await response.json();
    state.dirty = false;
    updateFileMeta();
    setStatus("done", "status.saved");
    await refreshFiles();
    await refreshVersions();
  } catch {
    setStatus("error", "files.saveFailed");
  } finally {
    state.saving = false;
  }
}

export async function createFile() {
  if (state.dirty) {
    const ok = await openDialog({
      title: t("files.unsavedTitle"),
      body: t("files.unsavedBody", { name: state.currentFile?.name || "" }),
      confirmLabel: t("files.discard"),
      cancelLabel: t("execute.cancel"),
      danger: true,
    });
    if (!ok) return;
    state.dirty = false;
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
    const response = await api.createFile(trimmed, graphToYaml(starterGraph()));
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

  const response = await api.deleteFile(file.id);
  if (!response.ok) {
    setStatus("error", "files.saveFailed");
    return;
  }

  if (state.currentFile?.id === file.id) {
    exitPreview();
    state.currentFile = null;
    state.versions = [];
    localStorage.removeItem("currentFileId");
    state.dirty = false;
  }

  await refreshFiles();
  if (!state.currentFile) {
    renderVersionList();
    if (state.files[0]) await selectFile(state.files[0].id, { force: true });
    else setEditorContent("");
  }
}

export async function loadInitialFile() {
  await refreshFiles();
  const savedId = Number(localStorage.getItem("currentFileId"));
  const match = state.files.find((file) => file.id === savedId) || state.files[0];
  if (match) await selectFile(match.id, { force: true });
  else setEditorContent("");
}
