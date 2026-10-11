#!/usr/bin/env python3
"""Generates the Inbox Report mock HTML files (sample data only)."""
import math, os
OUT = os.path.dirname(os.path.abspath(__file__))
FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
 '<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;1,9..144,400'
 '&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">')

P = {
 'mail':'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
 'home':'<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
 'users':'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
 'zap':'<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
 'book':'<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
 'activity':'<path d="M22 12h-4l-3 8L9 4l-3 8H2"/>',
 'x':'<path d="M6 6l12 12M18 6 6 18"/>',
 'help':'<path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7M12 17.5h.01"/>',
 'moon':'<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
 'refresh':'<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
 'search':'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
 'lock':'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
 'leaf':'<path d="M6 19c-1-8 4-14 14-14 0 10-5 15-13 14"/><path d="M6 19c2.5-4.5 5.5-7.5 9.5-9.5"/>',
 'bars':'<path d="M5 20V12M12 20V5M19 20v-9"/>',
 'share':'<path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
 'undo':'<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
 'chev':'<path d="m6 9 6 6 6-6"/>',
 'mailcheck':'<path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7"/><path d="m3 7 9 6 9-6"/><path d="m15 18 2 2 4-4"/>',
}
def ic(n, extra=''): return f'<svg class="i" viewBox="0 0 24 24" {extra}>{P[n]}</svg>'

def env(solid, w=18):
    h = round(w*14/18, 2)
    if solid:
        return (f'<svg viewBox="0 0 18 14" style="width:{w}px;height:{h}px"><rect x="1" y="1" width="16" height="12" rx="2.5" fill="var(--dm-primary)" stroke="var(--dm-primary)" stroke-width="1.4"/>'
                f'<path d="M2.6 2.8 9 7.8l6.4-5" fill="none" stroke="var(--dm-card)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>')
    return (f'<svg viewBox="0 0 18 14" style="width:{w}px;height:{h}px;opacity:.32"><rect x="1" y="1" width="16" height="12" rx="2.5" fill="none" stroke="var(--dm-primary)" stroke-width="1.4"/>'
            f'<path d="M2.6 2.8 9 7.8l6.4-5" fill="none" stroke="var(--dm-primary)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>')

def glyphs(w=18, gap=5, cap=True, capstyle=''):
    # 9 solid (emphasized, --dm-primary: plum in light, light plum in dark) = mail from senders you mostly leave unread;
    # 1 faded = the rest. Rounded to nearest 10%.
    g = ''.join(env(True, w) for _ in range(9)) + env(False, w)
    c = f'<span class="glyph-cap" style="{capstyle}">about 9 in 10 emails</span>' if cap else ''
    return f'<div class="glyphs" role="img" aria-label="About 9 in 10 emails" style="gap:{gap}px">{g}{c}</div>'

# Bundle H chrome (shared, single source): sibling screen-mocks (workspace) or screens (docs/design bundle)
SCREENS_CSS = '../../%s/src/screens.css' % next(d for d in ('screen-mocks', 'screens') if os.path.isdir(os.path.join(OUT, '..', '..', d, 'src')))
def doc(title, body, w, h, theme='light', extra_css='', screens=False):
    css = f'<link rel="stylesheet" href="{SCREENS_CSS}">' if screens else ''
    if screens and w > 400: extra_css += f'.s-shell{{width:{w}px;height:{h}px}}'
    return (f'<!doctype html><html lang="en" data-theme="{theme}"><head><meta charset="utf-8"><title>{title}</title>'
            f'<meta name="viewport" content="width={w}">{FONTS}<link rel="stylesheet" href="report.css">{css}'
            f'<style>html,body{{width:{w}px;height:{h}px}}{extra_css}</style></head><body>{body}</body></html>')

# Content inbox-report-copy v2 §3 (RECOMMENDED), word for word
TRUST = ('<div class="trust">' + ic('lock') + '<span>This report uses only the sender, date, size, labels and read/unread status of your email, plus who you’ve emailed. '
         'We never fetch or store full email contents. <span style="color:var(--dm-primary);font-weight:500;white-space:nowrap">What we store and share →</span></span></div>')

def badge(pos): return f'<div class="mock-badge" style="{pos}">Mockup · sample data</div>'

# ── chrome (matches Bundle H: /workspace/launch/screen-mocks/src/gen.py d_shell / m_shell) ──
NI = {
 'home':'m3 10 9-7 9 7v10H3V10Zm6 10v-7h6v7',
 'cleanup':'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8m5 10v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
 'auto':'m13 2-9 12h7l-1 8 10-12h-7l1-8Z',
 'catchup':'M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3V4Zm9 2v15',
 'activity':'M3 12h4l3-8 4 16 3-8h4',
 'menu':'M4 7h16M4 12h16M4 17h16',
}
def ni(n, s=20): return f'<svg class="i" viewBox="0 0 24 24" style="width:{s}px;height:{s}px"><path d="{NI[n]}"/></svg>'
RAIL = [('home','Home'),('cleanup','Cleanup'),('auto','Automations'),('catchup','Catch up'),('activity','Activity')]
TABS_M = [('home','Home'),('cleanup','Cleanup'),('auto','Auto'),('catchup','Catch up'),('activity','Activity')]
# Plus pill: visible "Plus"; spoken via visually hidden text (screen-copy A4: "Screener, Plus feature")
CLEAN_TABS = [('Senders','',True),('Triage','',False),('Screener','<span class="sr-only">, Plus feature</span><span class="pill-sm" aria-hidden="true">Plus</span>',False)]
def _tabs(cls):
    return f'<div class="{cls}">' + ''.join(f'<span class="{"on" if on else ""}">{t}{(" " + b) if b else ""}</span>' for t,b,on in CLEAN_TABS) + '</div>'

def d_shell(content):
    rail = ''.join(f'<div class="ri{" on" if k=="cleanup" else ""}" aria-label="{l}">{ni(k)}</div>' for k,l in RAIL)
    return (f'<div class="s-shell"><nav class="s-rail"><div class="brand">{ic("mailcheck","style=\"width:24px;height:24px\"")}</div>{rail}'
            f'<div class="sp"></div><div class="acct">A</div></nav><div class="s-main">'
            f'<div class="s-top"><span class="kicker">Cleanup</span><div class="icons"><span class="ib">{ic("help")}</span><span class="ib">{ic("moon")}</span><span class="ib"><span class="avatar" style="width:30px;height:30px">A</span></span></div></div>'
            f'{_tabs("s-tabs")}<div class="s-page">{content}</div></div></div>' + badge('right:14px;bottom:12px'))

def m_shell(content):
    tb = ''.join(f'<div class="t{" on" if k=="cleanup" else ""}">{ni(k)}<span>{l}</span></div>' for k,l in TABS_M)
    return (f'<div class="p-shell"><header class="p-head"><span class="ib" aria-label="Menu">{ni("menu")}</span>'
            f'<span class="mark">{ic("mailcheck","style=\"width:22px;height:22px\"")}</span><span style="flex:1"></span>'
            f'<span class="ib">{ic("help")}</span><span class="ib"><span class="avatar" style="width:30px;height:30px">A</span></span></header>'
            f'{_tabs("p-tabs")}<main class="p-scroll" style="top:97px">{content}</main><nav class="p-tabbar" id="tabbar">{tb}</nav></div>'
            + badge('right:10px;bottom:72px'))

def page_head(mobile=False, sub=True):
    # screen-copy v2 §P.3 / A3 senders.subtitle (RECOMMENDED)
    subl = '<p class="sub">Unsubscribe, archive or delete email by sender. You see what will change before anything moves.</p>' if sub else ''
    if mobile:
        return f'<div style="margin:2px 0 12px"><h1 class="h1">Senders</h1>{subl}</div>'
    return f'<div class="phead" style="margin-bottom:20px"><div><h1 class="h1">Senders</h1>{subl}</div></div>'

ROWS = [('E','Example Newsletter','news@example.com','6,412','received · retained'),
        ('S','Sample Store','hello@sample.example','4,980','received · retained'),
        ('D','Demo Travel Deals','offers@demo.example','3,377','received · retained'),
        ('P','Placeholder Weekly','digest@placeholder.example','2,915','received · retained')]
SMALL_ROWS = [('E','Example Updates','updates@example.com','96','received'),
              ('S','Sample Shop','hi@sample.example','71','received'),
              ('D','Demo Alerts','alerts@demo.example','58','received'),
              ('P','Placeholder Club','club@placeholder.example','44','received')]

def rows(rs, n=4, mobile=False):
    out=''
    for m,nm,ad,ct,lab in rs[:n]:
        out += (f'<div class="row"><div class="mono">{m}</div><div style="min-width:0"><div class="nm">{nm}</div>'
                f'<div class="ad">{ad}</div></div><div class="ct"><b>{ct}</b> <span style="font-size:13px;color:var(--dm-fg-soft)">emails</span><div>{lab}</div></div></div>')
    return out

def d_list(rs, total_label):
    return (f'<div style="display:grid;grid-template-columns:1.45fr 1fr;gap:20px;margin-top:20px">'
            f'<div class="card" style="padding:16px 18px"><div style="display:flex;gap:8px;margin-bottom:12px"><div class="search" style="flex:1">{ic("search")}Search senders…</div>'
            f'<div class="pill">Mail in inbox</div><div class="pill">Filter</div><div class="pill">Sort: Most received {ic("chev","style=\"width:14px;height:14px;margin-left:4px\"")}</div></div>'
            f'<div style="display:flex;align-items:baseline;justify-content:space-between;padding:6px 0 10px"><div><span style="font-family:var(--dm-font-display);font-size:28px" class="num">{total_label[0]}</span> <span style="color:var(--dm-fg-soft);font-size:15px">{total_label[1]}</span></div><span style="font-size:13px;font-weight:600">Select all</span></div>'
            f'{rows(rs)}</div>'
            f'<div class="card" style="padding:28px"><span class="kicker">A little context goes a long way</span>'
            f'<div style="font-size:17px;font-weight:600;margin:8px 0 6px">A closer look.</div>'
            f'<p style="font-size:13px;color:var(--dm-fg-soft);margin:0">Choose a sender to explore the pattern and make a considered decision.</p></div></div>')

def m_list(rs, total_label):
    return (f'<div class="card" style="padding:14px 14px 0;margin-top:12px"><div class="search">{ic("search")}Search senders…</div>'
            f'<div style="display:flex;align-items:baseline;justify-content:space-between;padding:12px 0 8px"><div><span style="font-family:var(--dm-font-display);font-size:26px" class="num">{total_label[0]}</span> <span style="color:var(--dm-fg-soft);font-size:14px">{total_label[1]}</span></div><span style="font-size:13px;font-weight:600">Select all</span></div>'
            f'{rows(rs, 4, True)}</div>')

KICK = '<span class="kicker">Your Inbox Report</span>'
XBTN = f'<div class="rp-x" aria-label="Dismiss report">{ic("x")}</div>'
HEAD_REST = 'of the email you got in the last 90 days came from <span class="num">195</span> senders you mostly leave unread.'
SUPPORT = 'Each had less than 10% of its email marked read in Gmail in that time.'
FACTS = ('<div class="facts"><div class="fact"><div class="n">85,207</div><div class="l">emails, going back to 2012</div></div>'
         '<div class="fact"><div class="n">About 1.5 GB</div><div class="l">of your email is in 118 messages over 5&nbsp;MB.</div></div></div>')
FOOTNOTE = '<div style="font-size:12px;color:var(--dm-fg-muted)">Sizes are Gmail’s estimates.</div>'
FIX_H = '<span class="num">122</span> of these senders include an unsubscribe link.'
CTA = 'Unsubscribe + archive 122 senders'

def d_reveal():
    panel = (f'<section class="report" id="report" style="padding:20px 28px 18px 32px">'
             f'<div class="rp-head">{KICK}<div style="display:flex;align-items:center;gap:6px;flex:none"><span class="tlink" style="font-size:13px;min-height:32px;gap:6px">{ic("share","style=\"width:15px;height:15px\"")}Make a share card</span>{XBTN}</div></div>'
             f'<div style="display:grid;grid-template-columns:320px 1.1fr 1.1fr;gap:28px;align-items:end;margin-top:12px">'
             f'<div><span class="display-xl" id="headline" aria-label="91 percent">91%</span><div class="rp-label" style="line-height:1.4">{HEAD_REST}</div></div>'
             f'<div style="padding-bottom:3px">{glyphs()}<p class="rp-sentence" style="margin:10px 0 0;font-size:13px;color:var(--dm-fg-soft)">{SUPPORT}</p></div>'
             f'<div style="padding-bottom:3px">{FACTS}<div style="margin-top:8px">{FOOTNOTE}</div></div></div>'
             f'<div class="hair" style="margin-top:16px"></div>'
             f'<div style="display:flex;align-items:flex-end;gap:16px;margin-top:12px"><div><div style="font-size:14px;color:var(--dm-fg);margin-bottom:8px">{FIX_H}</div>'
             f'<div style="display:flex;align-items:center;gap:16px"><button class="btn btn-primary" id="cta">{CTA}</button>'
             f'<span class="tlink p">Review them first</span><span class="tlink">Not now</span></div></div>'
             f'<div style="margin-left:auto;max-width:380px;padding-bottom:4px">{TRUST}</div></div></section>')
    return doc('Inbox Report · desktop', d_shell(page_head() + panel + d_list(ROWS, ('2,214','active senders'))), 1280, 800, screens=True)

def m_reveal():
    panel = (f'<section class="report" id="report" style="padding:14px 14px 10px 16px">'
             f'<div class="rp-head">{KICK}{XBTN}</div>'
             f'<span class="display-xl" id="headline" aria-label="91 percent" style="margin-top:8px">91%</span>'
             f'<div class="rp-label" style="line-height:1.4">{HEAD_REST}</div>'
             f'<div style="margin-top:12px">{glyphs(16,4)}</div>'
             f'<p style="margin:6px 0 0;font-size:13px;line-height:1.4;color:var(--dm-fg-soft)">{SUPPORT}</p>'
             f'<div class="hair" style="margin-top:12px"></div><div style="margin-top:10px">{FACTS}</div>'
             f'<div style="margin-top:6px">{FOOTNOTE}</div>'
             f'<div style="font-size:13px;color:var(--dm-fg);margin-top:14px">{FIX_H}</div>'
             f'<button class="btn btn-primary" id="cta" style="width:100%;margin-top:8px">{CTA}</button>'
             f'<div style="display:flex;justify-content:center;gap:28px;margin-top:2px"><span class="tlink p">Review them first</span><span class="tlink">Not now</span></div>'
             f'<div style="margin-top:2px">{TRUST}</div></section>')
    return doc('Inbox Report · mobile', m_shell(page_head(True) + panel + m_list(ROWS, ('2,214','active senders'))), 390, 844, screens=True)

# ── dismissed strip ───────────────────────────────────────
STRIP = (f'<div class="strip" id="strip"><span class="mark">{ic("bars")}</span><b>Your Inbox Report</b><span>·</span>'
         f'<span class="reopen">Reopen</span><span style="margin-left:auto;color:var(--dm-fg-muted)">{ic("chev")}</span></div>')
def d_dismissed():
    return doc('Inbox Report · dismissed · desktop', d_shell(page_head() + STRIP + d_list(ROWS, ('2,214','active senders'))), 1280, 800, screens=True)
def m_dismissed():
    return doc('Inbox Report · dismissed · mobile', m_shell(page_head(True) + STRIP + m_list(ROWS, ('2,214','active senders'))), 390, 844, screens=True)

# ── celebration ───────────────────────────────────────────
def burst(size=56):
    c = size/2
    cols = ['#59415f','#d8a975','#a98bb0','#b45309']
    dots=''
    for k in range(12):
        a = math.radians(k*30 + (7 if k%2 else -5))
        r = (size/2 + 12) + (6 if k%3==0 else (2 if k%3==1 else 9))
        s = [5,4,6,4][k%4]
        op = [1,.85,.7,.9][k%3]
        x = c + r*math.cos(a) - s/2; y = c + r*math.sin(a) - s/2
        dots += f'<i style="left:{x:.1f}px;top:{y:.1f}px;width:{s}px;height:{s}px;background:{cols[k%4]};opacity:{op}"></i>'
    chk = (f'<svg class="chk" viewBox="0 0 56 56" style="width:{size}px;height:{size}px"><circle cx="28" cy="28" r="26" fill="var(--dm-primary-soft)" stroke="var(--dm-primary)" stroke-width="2"/>'
           f'<path d="M17 29.5l7 7 15-16" fill="none" stroke="var(--dm-primary)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>')
    return f'<div class="burst" aria-hidden="true" style="width:{size}px;height:{size}px">{chk}{dots}</div>'

CEL_H = 'Archived <span class="num">2,708</span> emails from <span class="num">122</span> senders.'
QUIET = '<div class="quiet">Unsubscribe requested from 118 senders · 4 need you to send an email</div>'
UNDO_NOTE = '<div style="font-size:12px;color:var(--dm-fg-muted);line-height:1.4">Undo restores the archived email for 30 days. Unsubscribe requests can’t be recalled.</div>'
CHIP = '<span class="chip"><span class="tag">example</span>640 of 1,000 free emails left · resets Nov 1</span>'
# mobile: longer v2 chip text ("free emails") needs 12px/8px padding to stay on one line at 390
CHIP_M = CHIP.replace('class="chip"', 'class="chip" style="font-size:12px;padding:0 8px;gap:5px"')
# report v2 §4 celebration storage note (shown because the report showed insight #3, the 5 MB fact)
STORAGE_NOTE = '<div style="font-size:12px;color:var(--dm-fg-muted);line-height:1.4">Archived email stays in Gmail, so your storage doesn’t change. To free space, delete instead.</div>'

def d_celebrate():
    panel = (f'<section class="report" id="report" style="padding:20px 28px 18px 32px">'
             f'<div class="rp-head">{KICK}{XBTN}</div>'
             f'<div style="display:flex;align-items:center;gap:28px;margin-top:12px">'
             f'<div style="padding:18px">{burst(64)}</div>'
             f'<div style="flex:1;min-width:0"><h2 class="celebrate-h" style="font-size:32px;max-width:600px">{CEL_H}</h2>'
             f'<div style="margin-top:10px">{QUIET}</div><div style="margin-top:12px">{CHIP}</div><div style="margin-top:10px">{STORAGE_NOTE}</div></div>'
             f'<div style="display:flex;flex-direction:column;gap:8px;align-items:stretch;width:230px">'
             f'<button class="btn btn-quiet">{ic("undo","style=\"width:16px;height:16px\"")}Undo</button>'
             f'<button class="btn btn-ghost">{ic("share","style=\"width:16px;height:16px\"")}Make a share card</button>{UNDO_NOTE}</div></div>'
             f'<div class="hair" style="margin-top:14px"></div><div style="margin-top:12px">{TRUST}</div></section>')
    return doc('Inbox Report · celebration · desktop', d_shell(page_head() + panel + d_list(ROWS[1:]+ROWS[:1], ('2,092','active senders'))), 1280, 800, screens=True)

def m_celebrate():
    panel = (f'<section class="report" id="report" style="padding:14px 16px 14px 20px">'
             f'<div class="rp-head">{KICK}{XBTN}</div>'
             f'<div style="padding:26px 18px 14px">{burst(56)}</div>'
             f'<h2 class="celebrate-h">{CEL_H}</h2>'
             f'<div style="margin-top:8px">{QUIET}</div><div style="margin-top:10px">{CHIP_M}</div>'
             f'<div style="display:grid;grid-template-columns:1fr 1.6fr;gap:8px;margin-top:16px">'
             f'<button class="btn btn-quiet">{ic("undo","style=\"width:16px;height:16px\"")}Undo</button>'
             f'<button class="btn btn-ghost">{ic("share","style=\"width:16px;height:16px\"")}Make a share card</button></div>'
             f'<div style="margin-top:8px">{UNDO_NOTE}</div><div style="margin-top:6px">{STORAGE_NOTE}</div><div style="margin-top:12px">{TRUST}</div></section>')
    return doc('Inbox Report · celebration · mobile', m_shell(page_head(True, sub=False) + panel + m_list(ROWS[1:], ('2,092','active senders'))), 390, 844, screens=True)

# ── calm fallback ─────────────────────────────────────────
MARK = f'<div style="width:40px;height:40px;border-radius:50%;background:var(--dm-primary-soft);color:var(--dm-primary);display:grid;place-items:center;flex:none">{ic("leaf","style=\"width:20px;height:20px\"")}</div>'
CALM_H = '<h2 style="font-family:var(--dm-font-display);font-weight:400;font-size:32px;line-height:1.1;margin:0;letter-spacing:-.01em">Your inbox is in good shape.</h2>'
CALM_S = '<div style="font-size:15px;color:var(--dm-fg-soft);margin-top:6px" class="num">845 emails, and 12 senders that might be worth a look.</div>'
def d_fallback():
    panel = (f'<section class="report" id="report" style="padding:20px 28px 18px 32px">'
             f'<div class="rp-head">{KICK}{XBTN}</div>'
             f'<div style="display:flex;align-items:center;gap:18px;margin-top:14px">{MARK}<div style="flex:1">{CALM_H}{CALM_S}</div>'
             f'<button class="btn btn-ghost" id="cta">Show those 12 senders</button></div>'
             f'<div class="hair" style="margin-top:18px"></div><div style="margin-top:12px">{TRUST}</div></section>')
    return doc('Inbox Report · calm fallback · desktop', d_shell(page_head() + panel + d_list(SMALL_ROWS, ('31','active senders'))), 1280, 800, screens=True)
def m_fallback():
    panel = (f'<section class="report" id="report" style="padding:14px 16px 14px 20px">'
             f'<div class="rp-head">{KICK}{XBTN}</div>'
             f'<div style="margin-top:12px">{MARK}</div><div style="margin-top:12px">{CALM_H.replace("32px","24px")}{CALM_S}</div>'
             f'<button class="btn btn-ghost" id="cta" style="width:100%;margin-top:16px">Show those 12 senders</button>'
             f'<div style="margin-top:12px">{TRUST}</div></section>')
    return doc('Inbox Report · calm fallback · mobile', m_shell(page_head(True) + panel + m_list(SMALL_ROWS, ('31','active senders'))), 390, 844, screens=True)

# ── share cards ───────────────────────────────────────────
BRAND = lambda s: (f'<div style="display:flex;align-items:center;gap:{s*0.45:.0f}px;color:var(--dm-fg)">'
                   f'<svg class="i" viewBox="0 0 24 24" style="width:{s*1.2:.0f}px;height:{s*1.2:.0f}px;color:var(--dm-primary)">{P["mailcheck"]}</svg>'
                   f'<span style="font-family:var(--dm-font-display);font-size:{s}px;font-weight:500;letter-spacing:-.01em">DeclutrMail</span></div>')
def share_footer(fs):
    return (f'<div style="display:flex;align-items:center;justify-content:space-between;gap:24px;border-top:1px solid var(--dm-line);padding-top:{fs*1.2:.0f}px">'
            f'<span style="font-size:{fs*1.05:.0f}px;color:var(--dm-fg-soft)">Made with DeclutrMail · <span style="font-family:var(--dm-font-mono);font-weight:500;color:var(--dm-primary)">declutrmail.com</span></span>'
            f'<span style="display:flex;align-items:center;gap:8px;font-size:{fs}px;color:var(--dm-fg-muted)"><svg class="i" viewBox="0 0 24 24" style="width:{fs}px;height:{fs}px">{P["lock"]}</svg>We never fetch or store full email contents.</span></div>')
SHARE_CSS = ('.sc{position:absolute;inset:0;padding:64px;display:flex;flex-direction:column}'
             '.big{font-family:var(--dm-font-display);font-weight:400;letter-spacing:-.03em;line-height:.95;font-variant-numeric:tabular-nums lining-nums;font-variation-settings:"opsz" 144}'
             '.fn{font-family:var(--dm-font-display);font-weight:400;letter-spacing:-.02em;line-height:1;font-variant-numeric:tabular-nums lining-nums}'
             '.fl{color:var(--dm-fg-soft)}'
             '.kick{font-family:var(--dm-font-mono);text-transform:uppercase;letter-spacing:.1em;color:var(--dm-fg-muted)}')

TITLE = lambda s: (f'<div style="display:flex;align-items:center;gap:{s*0.45:.0f}px;color:var(--dm-fg)">'
                   f'<svg class="i" viewBox="0 0 24 24" style="width:{s*1.1:.0f}px;height:{s*1.1:.0f}px;color:var(--dm-primary)">{P["mailcheck"]}</svg>'
                   f'<span style="font-family:var(--dm-font-display);font-size:{s}px;font-weight:500;letter-spacing:-.01em">My Gmail, by the numbers</span></div>')
SC_PCT = '91%'  # mailbox R's current top insight (Content's example card shows 88%)

def share_wide(theme):
    body = (f'<div class="sc" id="safe">{TITLE(28)}'
            f'<div style="flex:1;display:flex;flex-direction:column;justify-content:center">'
            f'<div style="display:flex;align-items:baseline;flex-wrap:wrap;gap:0 4px"><span class="big" id="headline" style="font-size:112px">~85,000 emails</span><span class="fl" style="font-size:34px;font-family:var(--dm-font-display)">, going back to 2012</span></div></div>'
            f'<div style="display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:40px;margin-bottom:28px;align-items:end">'
            f'<div>{glyphs(22,6,False)}<div style="margin-top:12px;font-size:20px;line-height:1.3"><span class="fn" style="font-size:40px">{SC_PCT}</span><br><span class="fl">of my last 90 days came from senders I mostly leave unread</span></div></div>'
            f'<div><span class="fn" style="font-size:40px">≈ 7.7 GB</span><div class="fl" style="font-size:20px;margin-top:6px">of email</div></div>'
            f'<div><span class="fn" style="font-size:40px">~2,700</span><div class="fl" style="font-size:20px;margin-top:6px">archived in one go</div></div></div>'
            f'{share_footer(17)}</div>' + badge('right:16px;top:16px'))
    return doc(f'Share card 1200x630 {theme}', body, 1200, 630, theme, SHARE_CSS + 'body{position:relative}')

def share_tall(theme):
    body = (f'<div class="sc" id="safe" style="justify-content:space-between">{TITLE(36)}'
            f'<div><span class="big" id="headline" style="font-size:236px">~85,000</span>'
            f'<div style="font-size:52px;margin-top:18px;font-family:var(--dm-font-display);letter-spacing:-.01em">emails<span class="fl">, going back to 2012</span></div></div>'
            f'<div>{glyphs(56,14,False)}'
            f'<div style="margin-top:24px;font-family:var(--dm-font-display);font-size:50px;line-height:1.15;letter-spacing:-.01em"><span class="num">{SC_PCT}</span> <span class="fl">of my last 90 days came from senders I mostly leave unread</span></div></div>'
            f'<div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;border-top:1px solid var(--dm-line);padding-top:40px">'
            f'<div><span class="fn" style="font-size:96px">≈ 7.7 GB</span><div class="fl" style="font-size:28px;margin-top:12px">of email</div></div>'
            f'<div><span class="fn" style="font-size:96px">~2,700</span><div class="fl" style="font-size:28px;margin-top:12px">archived in one go</div></div></div>'
            f'{share_footer(22).replace("border-top:1px solid var(--dm-line);","")}</div>' + badge('right:18px;top:18px;font-size:13px'))
    return doc(f'Share card 1080x1350 {theme}', body, 1080, 1350, theme, SHARE_CSS + 'body{position:relative}')

FILES = {
 'desktop-senders-report.html': d_reveal, 'mobile-senders-report.html': m_reveal,
 'desktop-senders-report-dismissed.html': d_dismissed, 'mobile-senders-report-dismissed.html': m_dismissed,
 'desktop-report-celebration.html': d_celebrate, 'mobile-report-celebration.html': m_celebrate,
 'desktop-report-calm-fallback.html': d_fallback, 'mobile-report-calm-fallback.html': m_fallback,
 'share-1200x630-light.html': lambda: share_wide('light'), 'share-1200x630-dark.html': lambda: share_wide('dark'),
 'share-1080x1350-light.html': lambda: share_tall('light'), 'share-1080x1350-dark.html': lambda: share_tall('dark'),
}
if __name__ == '__main__':
    import sys
    only = set(sys.argv[1:])
    for f, fn in FILES.items():
        if only and f not in only: continue
        open(os.path.join(OUT, f), 'w').write(fn())
    print('\n'.join(FILES))
