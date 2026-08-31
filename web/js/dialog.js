let dialogResolver = null;

const els = {};

export function initDialog() {
  els.backdrop = document.getElementById("dialog-backdrop");
  els.title = document.getElementById("dialog-title");
  els.body = document.getElementById("dialog-body");
  els.input = document.getElementById("dialog-input");
  els.cancel = document.getElementById("dialog-cancel");
  els.ok = document.getElementById("dialog-ok");

  els.cancel.addEventListener("click", () => closeDialog(null));
  els.ok.addEventListener("click", () => {
    if (!els.input.classList.contains("hidden")) closeDialog(els.input.value);
    else closeDialog(true);
  });
  els.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      closeDialog(els.input.value);
    }
  });
  els.backdrop.addEventListener("click", (event) => {
    if (event.target === els.backdrop) closeDialog(null);
  });
}

export function isDialogOpen() {
  return els.backdrop && !els.backdrop.classList.contains("hidden");
}

export function closeDialog(result) {
  if (!isDialogOpen()) return;
  els.backdrop.classList.add("hidden");
  els.input.classList.add("hidden");
  els.ok.classList.remove("danger");
  const resolve = dialogResolver;
  dialogResolver = null;
  resolve?.(result);
}

export function openDialog({ title, body, confirmLabel, cancelLabel, input, danger }) {
  if (isDialogOpen()) closeDialog(null);

  return new Promise((resolve) => {
    dialogResolver = resolve;
    els.title.textContent = title;
    els.body.textContent = body;
    els.ok.textContent = confirmLabel;
    els.cancel.textContent = cancelLabel;
    els.ok.classList.toggle("danger", Boolean(danger));

    if (input) {
      els.input.classList.remove("hidden");
      els.input.value = input.value ?? "";
      els.input.placeholder = input.placeholder ?? "";
    } else {
      els.input.classList.add("hidden");
      els.input.value = "";
    }

    els.backdrop.classList.remove("hidden");
    window.setTimeout(() => {
      if (input) els.input.focus();
      else els.ok.focus();
    }, 0);
  });
}
