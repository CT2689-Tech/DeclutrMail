import type { ReactNode } from 'react';
import { tokens } from '@declutrmail/shared';

const { color, font, radius, shadow, text } = tokens;

const LEARN_CSS = `
.dm-learn * { box-sizing: border-box; }
.dm-learn a { color: inherit; }
.dm-learn-hero { max-width: 1060px; margin: 0 auto; padding: 72px 24px 42px; display: grid; grid-template-columns: minmax(0, 1.12fr) minmax(300px, .88fr); gap: 56px; align-items: center; }
.dm-learn-hero--solo { grid-template-columns: minmax(0, 760px); justify-content: center; }
.dm-learn-title { font-family: ${font.display}; font-size: clamp(42px, 7vw, 72px); line-height: .98; letter-spacing: -.045em; font-weight: 550; margin: 18px 0 22px; text-wrap: balance; }
.dm-learn-lead { color: ${color.fgSoft}; font-size: 18px; line-height: 1.7; margin: 0; max-width: 720px; }
.dm-learn-meta { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 22px; color: ${color.fgMuted}; font-family: ${font.mono}; font-size: ${text.xs}px; text-transform: uppercase; letter-spacing: .1em; }
.dm-learn-prose { max-width: 760px; margin: 0 auto; padding: 22px 24px 76px; }
.dm-learn-prose section { scroll-margin-top: 24px; padding: 34px 0; border-top: 1px solid ${color.lineSoft}; }
.dm-learn-prose h2 { font-family: ${font.display}; color: ${color.fg}; font-size: clamp(25px, 4vw, 34px); line-height: 1.15; letter-spacing: -.025em; font-weight: 560; margin: 0 0 16px; text-wrap: balance; }
.dm-learn-prose h3 { color: ${color.fg}; font-size: 15px; line-height: 1.45; margin: 0; }
.dm-learn-prose p { color: ${color.fgSoft}; font-size: 16px; line-height: 1.78; margin: 0 0 15px; }
.dm-learn-prose ul, .dm-learn-prose ol { color: ${color.fgSoft}; margin: 12px 0 0; padding-left: 23px; }
.dm-learn-prose li { font-size: 15px; line-height: 1.7; margin: 8px 0; }
.dm-learn-quick { border: 1px solid ${color.primaryBorder}; background: ${color.primaryWash}; border-radius: ${radius.lg}px; padding: 20px 22px; margin-bottom: 30px; }
.dm-learn-quick p { color: ${color.fg}; margin: 8px 0 0; }
.dm-learn-steps { list-style: none; padding: 0 !important; display: grid; gap: 12px; counter-reset: learn-step; }
.dm-learn-steps li { counter-increment: learn-step; display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 12px; background: ${color.card}; border: 1px solid ${color.lineSoft}; border-radius: ${radius.lg}px; padding: 16px; margin: 0; }
.dm-learn-steps li::before { content: counter(learn-step); width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; color: ${color.fgInverse}; background: ${color.primary}; font-family: ${font.mono}; font-size: ${text.xs}px; font-weight: 700; }
.dm-learn-step-copy p { font-size: 14px; line-height: 1.62; margin: 4px 0 0; }
.dm-learn-callout { border-left: 3px solid ${color.primary}; background: ${color.paper}; padding: 16px 18px; margin-top: 20px; border-radius: 0 ${radius.md}px ${radius.md}px 0; }
.dm-learn-callout--warning { border-left-color: ${color.amber}; background: ${color.amberBg}; }
.dm-learn-callout--truth { border-left-color: ${color.fg}; }
.dm-learn-callout p { font-size: 14px; margin: 5px 0 0; }
.dm-learn-example { background: ${color.fg}; color: ${color.fgInverse}; border-radius: ${radius.xl}px; box-shadow: ${shadow.lift}; overflow: hidden; }
.dm-learn-example-head { padding: 16px 18px; border-bottom: 1px solid ${color.lineInverse}; }
.dm-learn-example-label { font-family: ${font.mono}; font-size: 10px; text-transform: uppercase; letter-spacing: .12em; color: ${color.fgInverseMuted}; }
.dm-learn-example-head p { color: ${color.fgInverseSoft}; font-size: 13px; line-height: 1.5; margin: 7px 0 0; }
.dm-learn-example-row { display: grid; grid-template-columns: minmax(0, 1.4fr) auto; gap: 12px; padding: 15px 18px; border-bottom: 1px solid ${color.lineInverse}; }
.dm-learn-example-row:last-child { border-bottom: 0; }
.dm-learn-example-row strong { display: block; font-size: 13px; color: ${color.fgInverse}; }
.dm-learn-example-row small { display: block; margin-top: 3px; color: ${color.fgInverseMuted}; font-size: 11px; line-height: 1.45; }
.dm-learn-action { align-self: center; text-align: right; }
.dm-learn-action b { display: inline-block; padding: 5px 8px; border: 1px solid ${color.lineInverse}; border-radius: 9999px; color: ${color.fgInverse}; font-family: ${font.mono}; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; }
.dm-learn-action small { max-width: 160px; }
.dm-learn-related { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
.dm-learn-related a, .dm-learn-card { display: block; background: ${color.card}; border: 1px solid ${color.lineSoft}; border-radius: ${radius.lg}px; padding: 17px; text-decoration: none; transition: transform 150ms ease, border-color 150ms ease, box-shadow 150ms ease; }
.dm-learn-related a:hover, .dm-learn-card:hover { transform: translateY(-2px); border-color: ${color.primaryBorder}; box-shadow: ${shadow.card}; }
.dm-learn-related strong, .dm-learn-card strong { display: block; color: ${color.fg}; font-size: 14px; line-height: 1.35; }
.dm-learn-related span, .dm-learn-card span { display: block; color: ${color.fgMuted}; font-size: 12px; line-height: 1.55; margin-top: 7px; }
.dm-learn-grid { max-width: 1060px; margin: 0 auto; padding: 0 24px 76px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.dm-learn-card { padding: 22px; }
.dm-learn-card strong { font-family: ${font.display}; font-size: 22px; letter-spacing: -.015em; }
.dm-learn-card em { display: inline-block; color: ${color.primary}; font-family: ${font.mono}; font-size: 10px; font-style: normal; text-transform: uppercase; letter-spacing: .11em; margin-bottom: 14px; }
.dm-learn-faq { max-width: 840px; margin: 0 auto; padding: 10px 24px 80px; }
.dm-learn-faq details { border-top: 1px solid ${color.lineSoft}; padding: 21px 0; }
.dm-learn-faq summary { cursor: pointer; color: ${color.fg}; font-family: ${font.display}; font-size: 20px; line-height: 1.35; letter-spacing: -.01em; }
.dm-learn-faq p { color: ${color.fgSoft}; font-size: 15px; line-height: 1.75; margin: 13px 0 0; max-width: 720px; }
.dm-learn-faq a { color: ${color.primary}; }
.dm-learn-log { max-width: 840px; margin: 0 auto; padding: 10px 24px 80px; }
.dm-learn-log article { border-top: 1px solid ${color.line}; padding: 34px 0; }
.dm-learn-log h2 { font-family: ${font.display}; font-size: 29px; margin: 8px 0 10px; letter-spacing: -.02em; }
.dm-learn-log h3 { font-family: ${font.mono}; font-size: 10px; text-transform: uppercase; letter-spacing: .11em; margin: 22px 0 8px; color: ${color.fgMuted}; }
.dm-learn-log p, .dm-learn-log li { color: ${color.fgSoft}; font-size: 14px; line-height: 1.7; }
.dm-learn-evidence { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 18px; }
.dm-learn-evidence a { color: ${color.primary}; font-family: ${font.mono}; font-size: 10px; text-decoration: none; border: 1px solid ${color.primaryBorder}; border-radius: 9999px; padding: 5px 8px; }
@media (max-width: 820px) {
  .dm-learn-hero { grid-template-columns: 1fr; padding-top: 52px; gap: 34px; }
  .dm-learn-related, .dm-learn-grid { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
  .dm-learn-hero { padding: 42px 20px 30px; }
  .dm-learn-title { font-size: 42px; }
  .dm-learn-lead { font-size: 16px; }
  .dm-learn-prose, .dm-learn-grid, .dm-learn-faq, .dm-learn-log { padding-left: 20px; padding-right: 20px; }
  .dm-learn-example-row { grid-template-columns: 1fr; }
  .dm-learn-action { text-align: left; }
}
@media (prefers-reduced-motion: reduce) {
  .dm-learn-related a, .dm-learn-card { transition: none; }
}
`;

export function LearnShell({ children }: { children: ReactNode }) {
  return (
    <div className="dm-learn">
      <style>{LEARN_CSS}</style>
      {children}
    </div>
  );
}

export function LearnEyebrow({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        color: color.primary,
        fontFamily: font.mono,
        fontSize: 10,
        fontWeight: 650,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
      }}
    >
      {children}
    </span>
  );
}
