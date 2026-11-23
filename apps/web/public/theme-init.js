// Pre-paint theme and size: index.html loads this synchronously in <head>, so the page never
// flashes the wrong scheme or size. A file rather than an inline script, so the CSP's script-src
// stays 'self'. Keep the theme in sync with src/lib/theme.ts (resolveTheme);
// src/lib/theme.test.ts asserts they agree.
try {
  let t = localStorage.getItem("uroboros-theme");
  if (t !== "light" && t !== "dark") {
    t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.classList.toggle("dark", t === "dark");
  document.documentElement.style.colorScheme = t;
} catch {
  // Storage blocked: the stylesheet's own prefers-color-scheme default applies.
}

// Pre-paint size: the account menu's Size on the root (index.css's --ui-scale). Keep the key and
// the steps in sync with src/lib/uiScale.ts; src/lib/uiScale.test.ts asserts they agree.
try {
  const s = Number(localStorage.getItem("uroboros-ui-scale"));
  if ([0.9, 1, 1.1, 1.25].includes(s)) {
    document.documentElement.style.setProperty("--ui-scale", String(s));
  }
} catch {
  // Storage blocked: the stylesheet's --ui-scale of 1 applies.
}
