import { Route, Routes } from "react-router-dom";
import { BrandAtom, Display, Eyebrow } from "@/components/brand";

/**
 * Seed App.
 *
 * One route, one visible page. The placeholder proves the scaffold boots,
 * the design tokens render correctly, and the brand atoms compose as
 * expected. The first real feature replaces this placeholder.
 */
function HomePlaceholder() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-24">
      <BrandAtom size="lg" />
      <Eyebrow tone="primary">Scaffold ready</Eyebrow>
      <Display size="lg">
        DeclutrMail v2 — <em className="font-display-italic text-primary">starting fresh.</em>
      </Display>
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
