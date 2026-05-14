import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import "./index.css";

// Seed entry. Provider stack starts minimal; each feature adds the providers
// it actually needs (Auth, QueryClient, Theme, etc.) as it lands. Resist
// pre-adding providers for features that don't exist yet.

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </HelmetProvider>,
);
