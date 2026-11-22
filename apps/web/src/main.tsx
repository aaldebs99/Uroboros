import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/geist";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import "./index.css";
import { initTheme } from "./lib/theme";
import { createAppRouter } from "./router";

initTheme();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
const router = createAppRouter();

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

// Production only: in dev, `vite.config.ts` serves a `/sw.js` that removes itself. A new version
// installs, takes over and reloads the page into it (`registerType: "autoUpdate"`).
if (import.meta.env.PROD) registerSW({ immediate: true });
