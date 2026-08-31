import { state } from "./state.js";

const LOCALES = {
  en: "/i18n/en.json",
  "zh-Hant": "/i18n/zh-Hant.json",
};

const listeners = new Set();

export function onI18nChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key, vars = {}) {
  const value = key.split(".").reduce((obj, part) => obj?.[part], state.messages);
  let text = typeof value === "string" ? value : key;
  for (const [name, replacement] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(replacement));
  }
  return text;
}

export function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });
  document.title = t("app.title");

  const langBtnLabel = document.getElementById("lang-btn-label");
  const langMenu = document.getElementById("lang-menu");
  if (langBtnLabel) {
    langBtnLabel.textContent = state.currentLang === "en" ? "EN" : "繁";
  }
  langMenu?.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.setAttribute("aria-selected", btn.dataset.lang === state.currentLang ? "true" : "false");
  });

  for (const fn of listeners) fn();
}

export async function setLanguage(lang) {
  const next = LOCALES[lang] ? lang : "zh-Hant";
  const response = await fetch(LOCALES[next]);
  state.messages = await response.json();
  state.currentLang = next;
  localStorage.setItem("lang", next);
  document.documentElement.lang = next;
  applyTranslations();
}
