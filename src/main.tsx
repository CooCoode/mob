import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { isTauri } from "./components/TitleBar";
import "./index.css";
import { loadMachineSecrets } from "./store/app";

// The Tauri window is transparent with sidebar vibrancy behind the chrome.
if (isTauri) document.documentElement.classList.add("vibrancy");

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 5_000 } } });

// Credentials come from the keychain before the first request, so no request goes out unauthenticated.
void loadMachineSecrets().finally(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  ));
