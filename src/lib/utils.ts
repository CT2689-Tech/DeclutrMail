import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind-aware className merger. Use everywhere instead of template-string
 * concatenation so duplicate utilities (`px-4 px-6`) resolve to the last one
 * rather than rendering both into the DOM.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
