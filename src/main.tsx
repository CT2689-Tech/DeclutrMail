import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import "./index.css";

// Seed entry. Provider stack grows as features land — HelmetProvider is here
// because the Landing page sets per-page meta tags. Auth, QueryClient, Theme,
// etc. arrive with the features that need them.

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </HelmetProvider>,
);
