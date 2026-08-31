import { t } from "./i18n.js";
import { state } from "./state.js";

export function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function updateThemeButton() {
  const themeBtn = document.getElementById("theme-btn");
  if (!themeBtn) return;
  const sunIcon = themeBtn.querySelector(".theme-icon-sun");
  const moonIcon = themeBtn.querySelector(".theme-icon-moon");
  const light = currentTheme() === "light";
  sunIcon?.classList.toggle("hidden", light);
  moonIcon?.classList.toggle("hidden", !light);
  themeBtn.setAttribute("aria-label", t(light ? "theme.toDark" : "theme.toLight"));
}

export function applyTheme(theme) {
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
  state.editor?.setOption("theme", next === "light" ? "eclipse" : "material-darker");
  updateThemeButton();
}

export function toggleTheme() {
  applyTheme(currentTheme() === "light" ? "dark" : "light");
}
