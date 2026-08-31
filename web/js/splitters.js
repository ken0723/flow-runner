export function setupSplitters(editor) {
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
