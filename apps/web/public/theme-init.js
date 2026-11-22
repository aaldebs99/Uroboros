// Pre-paint theme: index.html loads this synchronously in <head>, so the page never flashes the
// wrong scheme. A file rather than an inline script, so the CSP's script-src stays 'self'.
// Keep in sync with src/lib/theme.ts (resolveTheme); src/lib/theme.test.ts asserts they agree.
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
