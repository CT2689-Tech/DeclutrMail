import { cn } from "@/lib/utils";

/**
 * BrandAtom — canonical "D·  Declutr*Mail*" logo mark.
 *
 * Single source of truth for the wordmark across marketing + product.
 * The square teal mark + italic "Mail" accent are the brand. Don't recreate
 * inline; always use this component. Wrap in a `<Link>` for clickable usage.
 *
 * Source: /tmp/declutr-design/.../ui_kits/product/v2/marketing/v2-marketing.css
 *         (`.masthead .brand .mark` + `.masthead .brand .word` patterns)
 */
export type BrandAtomProps = {
  /** `sm` = compact (footer / dense headers), `md` = default, `lg` = hero. */
  size?: "sm" | "md" | "lg";
  className?: string;
};

const SIZES: Record<"sm" | "md" | "lg", { mark: string; word: string }> = {
  sm: { mark: "h-5 w-5 text-[11px]", word: "text-[14px]" },
  md: { mark: "h-[26px] w-[26px] text-[14px]", word: "text-[18px]" },
  lg: { mark: "h-9 w-9 text-[18px]", word: "text-[22px]" },
};

export function BrandAtom({ size = "md", className }: BrandAtomProps) {
  const s = SIZES[size];
  return (
    <span className={cn("inline-flex items-baseline gap-[10px] text-foreground", className)}>
      <span
        className={cn(
          s.mark,
          "inline-flex items-center justify-center self-center rounded-[5px] bg-primary font-display font-bold leading-none text-white",
        )}
        style={{ fontVariationSettings: '"opsz" 144' }}
        aria-hidden="true"
      >
        D<em className="ml-px font-display-italic text-white/55">·</em>
      </span>
      <span
        className={cn("font-display font-bold leading-none", s.word)}
        style={{ letterSpacing: "-0.008em" }}
      >
        Declutr<em className="font-display-italic text-primary">Mail</em>
      </span>
    </span>
  );
}
