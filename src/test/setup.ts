import "@testing-library/jest-dom";
import { expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

// jsdom mocks for IntersectionObserver / ResizeObserver / matchMedia are
// added as features land that need them. The seed brand atoms don't.
