import { Route, Routes } from "react-router-dom";
import { BrandAtom } from "@/components/brand";

/**
 * Seed App.
 *
 * One route, one visible page. The placeholder proves the scaffold boots,
 * the design tokens render correctly, and the brand atom composes as
 * expected. Replaced page-by-page as marketing surfaces land.
 */
function HomePlaceholder() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-24">
      <BrandAtom size="lg" />
      <div className="font-mono-edit text-[10px] font-medium leading-tight text-primary">
        Scaffold ready
      </div>
      <h1 className="font-display text-display-md">
        DeclutrMail v2 — <em className="font-display-italic text-primary">starting fresh.</em>
      </h1>
      <p className="max-w-prose text-base leading-relaxed text-ink-sub">
        Seed scaffold. Design tokens loaded, brand components mounted, font axis live. The first
        feature replaces this page.
      </p>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePlaceholder />} />
    </Routes>
  );
}
