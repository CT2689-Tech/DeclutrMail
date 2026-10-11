#!/usr/bin/env python3
"""Bundle H screen mocks: Home v1, Coming with Pro, nav badge, caught-up. Sample data only."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
# sibling folder: inbox-report-mocks (workspace) or inbox-report (docs/design bundle)
_R = next(d for d in ('inbox-report-mocks', 'inbox-report') if os.path.isdir(os.path.join(HERE, '..', '..', d, 'src')))
sys.path.insert(0, os.path.join(HERE, '..', '..', _R, 'src'))
import gen as R  # icons, envelope glyphs, fonts from the report mocks
P, ic, glyphs, FONTS = R.P, R.ic, R.glyphs, R.FONTS

# Repo nav icons (packages/shared/src/shell/sidebar.tsx)
NI = {
 'home':'m3 10 9-7 9 7v10H3V10Zm6 10v-7h6v7',
 'cleanup':'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8m5 10v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
 'auto':'m13 2-9 12h7l-1 8 10-12h-7l1-8Z',
 'catchup':'M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3V4Zm9 2v15',
 'activity':'M3 12h4l3-8 4 16 3-8h4',
 'senders':'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8m5 10v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
 'triage':'M3 6h18M6 12h12M9 18h6',
 'screener':'M9 12l2 2 4-4M21 12c0 5-4 9-9 9s-9-4-9-9 4-9 9-9c1 0 2 0 3 .5',
 'autopilot':'M12 2L2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
 'quiet':'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
 'brief':'M4 4h12l4 4v12a2 2 0 0 1-2 2H4zM14 4v4h6',
 'followups':'M4 4h16v12H9l-5 4V4Zm4 4h8M8 12h5',
 'later':'M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
 'card':'M3 6h18v12H3zM3 10h18',
 'gear':'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
 'menu':'M4 7h16M4 12h16M4 17h16',
 'check':'M20 6 9 17l-5-5',
 'refresh':'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
 'scan':'M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M7 12h10',
 'arrow':'M5 12h14M13 6l6 6-6 6',
}
def ni(n, s=18, style=''): return f'<svg class="i" viewBox="0 0 24 24" style="width:{s}px;height:{s}px;{style}"><path d="{NI[n]}"/></svg>'

def doc(title, body, w, h, theme):
    return (f'<!doctype html><html lang="en" data-theme="{theme}"><head><meta charset="utf-8"><title>{title}</title>'
            f'<meta name="viewport" content="width={w}">{FONTS}<link rel="stylesheet" href="base.css"><link rel="stylesheet" href="screens.css">'
            f'<style>html,body{{width:{w}px;height:{h}px}}</style></head><body>{body}</body></html>')
def badge(pos): return f'<div class="mock-badge" style="{pos}">Mockup · sample data</div>'

# inbox-report-copy v2 §3 (RECOMMENDED), word for word
TRUST = ('<div class="trust">' + ic('lock') + '<span>This report uses only the sender, date, size, labels and read/unread status of your email, plus who you’ve emailed. '
         'We never fetch or store full email contents. <span style="color:var(--dm-primary);font-weight:500;white-space:nowrap">What we store and share →</span></span></div>')
# inbox-report-copy v2 §6.1/7.1 Free chip
CHIP = '<span class="chip"><span class="tag">example</span>640 of 1,000 free emails left · resets Nov 1</span>'
PLANLINE = f'<div class="planline">{CHIP}<span>Free plan · <span class="link" style="font-size:13px">Compare plans</span></span></div>'

# ── shells ────────────────────────────────────────────────
RAIL = [('home','Home'),('cleanup','Cleanup'),('auto','Automations'),('catchup','Catch up'),('activity','Activity')]
def d_shell(active, location, content, tabs=None):
    rail = ''.join(f'<div class="ri{" on" if k==active else ""}" aria-label="{l}">{ni(k,20)}</div>' for k,l in RAIL)
    tb = ''
    if tabs:
        tb = '<div class="s-tabs">' + ''.join(f'<span class="{"on" if on else ""}">{t}{(" " + b) if b else ""}</span>' for t,b,on in tabs) + '</div>'
    return (f'<div class="s-shell"><nav class="s-rail"><div class="brand">{ic("mailcheck","style=\"width:24px;height:24px\"")}</div>{rail}'
            f'<div class="sp"></div><div class="acct">A</div></nav><div class="s-main">'
            f'<div class="s-top"><span class="kicker">{location}</span><div class="icons"><span class="ib">{ic("help")}</span><span class="ib">{ic("moon")}</span><span class="ib"><span class="avatar" style="width:30px;height:30px">A</span></span></div></div>'
            f'{tb}<div class="s-page">{content}</div></div></div>' + badge('right:14px;bottom:12px'))

TABS_M = [('home','Home'),('cleanup','Cleanup'),('auto','Auto'),('catchup','Catch up'),('activity','Activity')]
def m_shell(active, content, tabs=None, overlay='', badgepos='right:10px;bottom:72px'):
    tb = ''.join(f'<div class="t{" on" if k==active else ""}">{ni(k,20)}<span>{l}</span></div>' for k,l in TABS_M)
    sub = ''
    top = 52
    if tabs:
        sub = '<div class="p-tabs">' + ''.join(f'<span class="{"on" if on else ""}">{t}{(" " + b) if b else ""}</span>' for t,b,on in tabs) + '</div>'
        top = 97
    return (f'<div class="p-shell"><header class="p-head"><span class="ib" aria-label="Menu">{ni("menu",20)}</span>'
            f'<span class="mark">{ic("mailcheck","style=\"width:22px;height:22px\"")}</span><span style="flex:1"></span>'
            f'<span class="ib">{ic("help")}</span><span class="ib"><span class="avatar" style="width:30px;height:30px">A</span></span></header>'
            f'{sub}<main class="p-scroll" style="top:{top}px">{content}</main><nav class="p-tabbar" id="tabbar">{tb}</nav>{overlay}</div>'
            + badge(badgepos))

# ── Home modules ──────────────────────────────────────────
HEAD_REST = 'of the email you got in the last 90 days came from <span class="num">195</span> senders you mostly leave unread.'
SUPPORT = 'Each had less than 10% of its email marked read in Gmail in that time.'
# report v2 §4: "about" in sentences (≈ only on the share card / compact chips); label = share-card line "of email"
F1 = ('About 7.7 GB', 'of email')
# report v2 §2 card ("about" in sentences) + §P: "labels" explained on first use in the report
F2 = ('47,764', 'emails (about 4.4 GB) are filed under Unroll.me labels (Gmail’s version of folders) in your Gmail.')
def facts(cols=''): return (f'<div class="facts" style="{cols}"><div class="fact"><div class="n">{F1[0]}</div><div class="l">{F1[1]}</div></div>'
                     f'<div class="fact"><div class="n">{F2[0]}</div><div class="l">{F2[1]}</div></div></div>')
FOOT = '<div style="font-size:12px;color:var(--dm-fg-muted)">Sizes are Gmail’s estimates.</div>'
RKICK = '<span class="kicker">Your Inbox Report · Updated 6:10 AM</span>'
SHARE = f'<span class="tlink" style="font-size:13px;min-height:32px;gap:6px">{ic("share","style=\"width:15px;height:15px\"")}Make a share card</span>'

def report_full_d():
    return (f'<section class="card2" style="padding:22px 32px 20px" aria-label="Your Inbox Report">'
            f'<div style="display:flex;justify-content:space-between;align-items:center">{RKICK}{SHARE}</div>'
            f'<div style="display:grid;grid-template-columns:310px 1fr 1.3fr;gap:36px;align-items:end;margin-top:10px">'
            f'<div><span class="display-xl" aria-label="91 percent">91%</span><div class="rp-label" style="line-height:1.4">{HEAD_REST}</div></div>'
            f'<div style="padding-bottom:3px">{glyphs()}<p style="margin:10px 0 0;font-size:13px;line-height:1.45;color:var(--dm-fg-soft)">{SUPPORT}</p></div>'
            f'<div style="padding-bottom:3px">{facts("grid-template-columns:1fr;gap:10px")}<div style="margin-top:8px">{FOOT}</div></div></div>'
            f'<div class="hair" style="margin-top:16px"></div><div style="margin-top:12px">{TRUST}</div></section>')

def report_full_m():
    return (f'<section class="card2" style="padding:14px 16px 12px" aria-label="Your Inbox Report">'
            f'{RKICK}'
            f'<span class="display-xl" aria-label="91 percent" style="margin-top:6px">91%</span>'
            f'<div class="rp-label" style="line-height:1.4">{HEAD_REST}</div>'
            f'<div style="margin-top:10px">{glyphs(16,4)}</div>'
            f'<p style="margin:6px 0 0;font-size:13px;line-height:1.4;color:var(--dm-fg-soft)">{SUPPORT}</p>'
            f'<div class="hair" style="margin-top:10px"></div><div style="margin-top:8px">{facts()}</div><div style="margin-top:6px">{FOOT}</div></section>')

# Suggested next steps (Content screen-copy §7.2, RECOMMENDED)
NEXT_L = 'Suggested next steps'
FIX_T = '<span class="num">158</span> senders you mostly leave unread have an unsubscribe link'
# screen-copy A5 (RECOMMENDED, mobile): icon-only info button after "mostly leave unread"; 44px target, no extra height
INFO_BTN = ('<button class="info-btn" aria-label="What “mostly leave unread” means">'
            '<svg class="i" viewBox="0 0 24 24" style="width:16px;height:16px"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-5M12 8h.01"/></svg></button>')
FIX_T_M = '<span class="num">158</span> senders you mostly leave unread' + INFO_BTN + ' have an unsubscribe link'
FIX_S = 'Less than 10% of their email was marked read in the last 90 days.'
FIX_B = 'Unsubscribe + archive 158 senders'
LRG_T = 'Your 10 largest senders'
LRG_S = 'About 2.1 GB of email (Gmail’s estimate). Archiving doesn’t free storage. Deleting moves email to Gmail Trash, which Gmail empties after 30 days.'
LRG_B = 'See largest senders'
LTR_T = '<span class="num">3</span> senders come back from Later today'
LTR_S = 'Their email returns to your inbox at the time you picked.'
LTR_B = 'Open Later'
def nextbest_d():
    sec = lambda t,b,l: (f'<div class="card14" style="padding:18px 20px;display:flex;flex-direction:column;gap:6px"><div class="h3">{t}</div>'
                         f'<div class="body" style="flex:1">{b}</div><span class="link">{l}</span></div>')
    return (f'<section style="margin-top:24px" aria-label="{NEXT_L}"><div class="kicker" style="margin-bottom:10px">{NEXT_L}</div>'
            f'<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:16px">'
            f'<div class="fixcard" style="padding:20px 22px"><div class="h3" style="max-width:520px">{FIX_T}</div>'
            f'<div class="body" style="margin-top:4px">{FIX_S}</div>'
            f'<div style="display:flex;align-items:center;gap:16px;margin-top:14px"><button class="btn btn-primary" data-primary>{FIX_B}</button><span class="tlink p">Review them first</span></div></div>'
            + sec(LRG_T, LRG_S, LRG_B) + sec(LTR_T, LTR_S, LTR_B) + '</div></section>')

def nextbest_m():
    return (f'<section style="margin-top:16px" aria-label="{NEXT_L}"><div class="kicker" style="margin-bottom:8px">{NEXT_L}</div>'
            f'<div class="fixcard" style="padding:14px 16px 6px"><div class="h3" style="font-size:15px">{FIX_T_M}</div>'
            f'<button class="btn btn-primary" data-primary style="width:100%;margin-top:12px">{FIX_B}</button>'
            f'<div style="display:flex;justify-content:center"><span class="tlink p">Review them first</span></div></div>'
            f'<div style="margin-top:14px">{TRUST}</div>'
            f'<div class="card14" style="padding:14px 16px;margin-top:14px"><div class="h3" style="font-size:15px">{LRG_T}</div><div class="body">{LRG_S}</div></div></section>')

def progress(mobile=False, calm=False):
    lbl = 'Progress since you joined · ' + ('Sep 28' if calm else 'Aug 11')
    txt = ('<span class="num">212</span> emails archived or deleted · <span class="num">9</span> senders decided' if calm else
           '<span class="num">3,310</span> emails archived or deleted · <span class="num">41</span> senders decided')
    if mobile:
        return (f'<section class="card14" style="padding:14px 16px;margin-top:14px"><div class="kicker">{lbl}</div>'
                f'<div class="body" style="margin-top:4px;color:var(--dm-fg)">{txt}</div><span class="link" style="display:inline-block;margin-top:6px">See your activity</span></section>')
    return (f'<section class="card14" style="padding:16px 20px;margin-top:16px;display:flex;align-items:center;gap:20px"><span class="kicker">{lbl}</span>'
            f'<span class="body" style="color:var(--dm-fg);flex:1">{txt}</span><span class="link">See your activity</span></section>')

def phead_d():
    return f'<div class="phead"><h1 class="h1">Home</h1>{PLANLINE}</div>'
def phead_m():
    return (f'<div style="margin:2px 0 12px"><h1 class="h1">Home</h1><div style="margin-top:8px">{CHIP}</div></div>')

# calm
CALM_T = 'Your inbox is in good shape'
CALM_S = 'Nothing stands out right now. New senders and changes show up here after each scan.'
CALM_B = 'See your senders'
def calm_card(mobile):
    if mobile:
        return (f'<section class="card2" style="padding:14px 16px 14px">{RKICK}'
                f'<div style="margin-top:12px" class="iconcirc">{ic("leaf")}</div>'
                f'<h2 style="font-family:var(--dm-font-display);font-weight:400;font-size:24px;line-height:1.15;margin:12px 0 0">{CALM_T}</h2>'
                f'<div class="body" style="font-size:15px;margin-top:6px">{CALM_S}</div>'
                f'<button class="btn btn-ghost" data-primary style="width:100%;margin-top:14px">{CALM_B}</button>'
                f'<div style="margin-top:12px">{TRUST}</div></section>')
    return (f'<section class="card2" style="padding:22px 32px 20px">{RKICK}'
            f'<div style="display:flex;align-items:center;gap:18px;margin-top:14px"><div class="iconcirc">{ic("leaf")}</div><div style="flex:1">'
            f'<h2 style="font-family:var(--dm-font-display);font-weight:400;font-size:32px;line-height:1.1;margin:0">{CALM_T}</h2>'
            f'<div class="body" style="font-size:15px;margin-top:6px">{CALM_S}</div></div>'
            f'<button class="btn btn-ghost" data-primary>{CALM_B}</button></div>'
            f'<div class="hair" style="margin-top:18px"></div><div style="margin-top:12px">{TRUST}</div></section>')

# empty = report not ready (first scan of this Gmail account still running; nothing decided yet)
EMPTY_T = 'Your first scan is running'
EMPTY_B = 'Senders appear as the scan finishes. You can close this tab.'
def empty_card(mobile):
    pad = '14px 16px 14px' if mobile else '24px 32px 22px'
    btn_style = 'width:100%;margin-top:16px' if mobile else 'margin-top:18px'
    return (f'<section class="card2" style="padding:{pad}"><span class="kicker">Your Inbox Report</span>'
            f'<div style="display:flex;gap:16px;align-items:flex-start;margin-top:14px;{"flex-direction:column;gap:12px" if mobile else ""}">'
            f'<div class="iconcirc">{ni("scan",20)}</div><div style="flex:1;max-width:620px">'
            f'<h2 class="h2s">{EMPTY_T}</h2><div class="body" style="margin-top:4px">{EMPTY_B}</div>'
            f'<div class="progress" style="margin-top:16px" role="progressbar" aria-label="Scan progress" aria-valuenow="62" aria-valuemin="0" aria-valuemax="100"><i></i></div>'
            f'<div style="font-size:12px;color:var(--dm-fg-muted);margin-top:6px" class="num">Found 31,214 emails</div>'
            f'<button class="btn btn-quiet" data-primary style="{btn_style}">See your senders</button></div></div>'
            f'<div class="hair" style="margin-top:18px"></div><div style="margin-top:12px">{TRUST}</div></section>')

# scan failed: calm, neutral, retry on Home
FAIL_K = 'Gmail account needs attention'
FAIL_T = 'The scan stopped'
FAIL_B = 'Something interrupted the scan. Your Gmail hasn’t been changed. Try again, or email support@declutrmail.com if it keeps happening.'
def failed_card(mobile):
    pad = '14px 16px 14px' if mobile else '24px 32px 22px'
    if mobile:
        acts = (f'<button class="btn btn-primary" data-primary style="width:100%;margin-top:16px">{ic("refresh","style=\"width:16px;height:16px\"")}Try again</button>'
                f'<div style="display:flex;justify-content:center"><span class="tlink">Get help</span></div>')
    else:
        acts = (f'<div style="display:flex;align-items:center;gap:16px;margin-top:18px"><button class="btn btn-primary" data-primary>{ic("refresh","style=\"width:16px;height:16px\"")}Try again</button>'
                f'<span class="tlink">Get help</span></div>')
    return (f'<section class="card2" style="padding:{pad}"><span class="kicker">{FAIL_K}</span>'
            f'<div style="display:flex;gap:16px;align-items:flex-start;margin-top:14px;{"flex-direction:column;gap:12px" if mobile else ""}">'
            f'<div class="iconcirc">{ni("refresh",20)}</div><div style="flex:1;max-width:620px">'
            f'<h2 class="h2s">{FAIL_T}</h2><div class="body" style="margin-top:4px">{FAIL_B}</div>'
            f'<div style="font-size:12px;color:var(--dm-fg-muted);margin-top:8px" class="num">52,180 of 85,207 emails</div>'
            f'{acts}</div></div>'
            f'<div class="hair" style="margin-top:18px"></div><div style="margin-top:12px">{TRUST}</div></section>')

def home(state, dev, theme):
    if dev == 'desktop':
        body = phead_d() + {'full': lambda: report_full_d() + nextbest_d() + progress(),
                            'calm': lambda: calm_card(False) + progress(calm=True),
                            'empty': lambda: empty_card(False),
                            'scan-failed': lambda: failed_card(False)}[state]()
        return doc(f'Home · {state}', d_shell('home', '', body), 1440, 900, theme)
    body = phead_m() + {'full': lambda: report_full_m() + nextbest_m(),
                        'calm': lambda: calm_card(True) + progress(True, calm=True),
                        'empty': lambda: empty_card(True),
                        'scan-failed': lambda: failed_card(True)}[state]()
    return doc(f'Home · {state} · mobile', m_shell('home', body), 390, 844, theme)

# ── Coming with Pro (Daily Brief) ─────────────────────────
PRO_BADGE = 'Coming with Pro'
PRO_PITCH = 'A daily summary of yesterday’s email in DeclutrMail, ready at an hour you choose.'
PRO_STATUS = 'Pro isn’t available yet.'
PRO_CTA = 'Join the Pro waitlist'
BRIEF_PROCESSING_NOTE = 'Daily Brief may send the sender, subject line, and Gmail preview snippet to Anthropic to compose a summary. Full email contents and attachments are never sent.'
PLUS_SUB = '<span class="sr-only">, Plus feature</span><span class="pill-sm" aria-hidden="true">Plus</span>'
PRO_SUB = '<span class="sr-only">, coming with Pro</span><span class="pill-sm" aria-hidden="true">Pro</span>'
CATCH_TABS_D = [('Later','',False),('Daily Brief',PRO_SUB,True),('Follow-ups',PRO_SUB,False)]
def brief_preview(mobile=False):
    def block(lbl, n):
        rows = ''.join(f'<div style="display:flex;gap:10px;align-items:center;padding:8px 0"><div style="width:28px;height:28px;border-radius:8px;background:var(--dm-fill)"></div>'
                       f'<div style="flex:1"><div class="skel" style="width:{w}%"></div><div class="skel" style="width:{w-22}%;margin-top:6px;height:8px"></div></div></div>'
                       for w in [78,64,71][:n])
        return f'<div style="margin-top:14px"><div class="kicker">{lbl}</div>{rows}</div>'
    return (f'<div class="card14 fade-preview" aria-hidden="true" style="padding:18px 20px;{"margin-top:16px" if mobile else "height:100%"}">'
            f'<div style="display:flex;justify-content:space-between;align-items:center"><div class="skel" style="width:38%;height:14px"></div><div class="skel" style="width:64px;height:20px"></div></div>'
            f'<div class="skel" style="width:92%;margin-top:14px"></div><div class="skel" style="width:84%;margin-top:8px"></div>'
            + block('Needs a reply', 2) + block('Updates', 3 if not mobile else 2) + '</div>')

def pro_panel(mobile=False):
    # Waitlist only (plan §2.3): no /billing link, no price, no checkout. Button posts to the waitlist endpoint.
    note = f'<p style="font-size:12px;line-height:1.45;color:var(--dm-fg-muted);margin:14px 0 0">{BRIEF_PROCESSING_NOTE}</p>'
    if mobile:
        return (f'<section class="card2" style="padding:16px 16px 14px"><h2 class="h2s">{PRO_STATUS}</h2>'
                f'<button class="btn btn-primary" data-primary data-action="waitlist:pro" style="width:100%;margin-top:14px">{PRO_CTA}</button>'
                f'<div style="display:flex;justify-content:center"><span class="tlink" data-href="/later">Go to Later</span></div>'
                f'<p style="font-size:12px;line-height:1.45;color:var(--dm-fg-muted);margin:4px 0 0">{BRIEF_PROCESSING_NOTE}</p></section>'
                + brief_preview(True))
    return (f'<section class="card2" style="padding:28px 32px;display:grid;grid-template-columns:1fr 1.1fr;gap:40px;align-items:stretch">'
            f'<div style="display:flex;flex-direction:column;justify-content:center">'
            f'<h2 class="h2s" style="font-size:24px;max-width:420px">{PRO_STATUS}</h2>'
            f'<div style="display:flex;align-items:center;gap:16px;margin-top:20px"><button class="btn btn-primary" data-primary data-action="waitlist:pro">{PRO_CTA}</button><span class="tlink" data-href="/later">Go to Later</span></div>'
            f'<div style="max-width:440px">{note}</div></div>'
            f'<div style="min-height:300px">{brief_preview()}</div></section>')

PRO_HEAD_D = (f'<div class="phead" style="margin-bottom:20px"><div><span class="pill">{PRO_BADGE}</span>'
              f'<h1 class="h1" style="margin-top:10px">Daily Brief</h1><p class="sub">{PRO_PITCH}</p></div></div>')
PRO_HEAD_M = (f'<div style="margin:2px 0 14px"><span class="pill">{PRO_BADGE}</span>'
              f'<h1 class="h1" style="margin-top:8px">Daily Brief</h1><p class="sub">{PRO_PITCH}</p></div>')
def pro_locked(dev):
    if dev == 'desktop':
        return doc('Coming with Pro · desktop', d_shell('catchup', 'Catch up', PRO_HEAD_D + pro_panel(), CATCH_TABS_D), 1440, 900, 'light')
    return doc('Coming with Pro · mobile', m_shell('catchup', PRO_HEAD_M + pro_panel(True), CATCH_TABS_D), 390, 844, 'light')

# ── Pro nav badge: expanded sidebar + mobile drawer ───────
NAVLIST = [('Home', [('home','Home','',True)]),
           ('Cleanup', [('senders','Senders','',False),('triage','Triage','',False),('screener','Screener','Plus',False)]),
           ('Automations', [('autopilot','Autopilot','Plus',False),('quiet','Quiet hours','Plus',False)]),
           ('Catch up', [('later','Later','',False),('brief','Daily Brief','Pro',False),('followups','Follow-ups','Pro',False)]),
           ('', [('activity','Activity','',False)])]
def navrows(active):
    out = ''
    for g, items in NAVLIST:
        if g and g != 'Home': out += f'<div class="grp">{g}</div>'
        elif not g: out += '<div style="height:10px"></div>'
        for k, l, lock, _ in items:
            on = ' on' if k == active else ''
            # screen-copy A4: spoken "Screener, Plus feature" / "Daily Brief, coming with Pro"; visible pill unchanged
            spoken = ', coming with Pro' if lock == 'Pro' else f', {lock} feature'
            pill = f'<span class="sr-only">{spoken}</span><span class="nav-pill" aria-hidden="true">{lock}</span>' if lock else ''
            out += f'<div class="nrow{on}">{ni(k,18)}<span class="lbl">{l}</span>{pill}</div>'
    return out
FOOTROWS = (f'<div class="nrow">{ni("card",18)}<span class="lbl">Plan &amp; billing</span><span style="font-size:12px;color:var(--dm-nav-muted)">Free</span></div>'
            f'<div class="nrow">{ni("gear",18)}<span class="lbl">Settings</span></div>'
            f'<div class="nrow" style="height:48px;margin-top:6px;background:#ffffff0d"><span class="avatar" style="width:28px;height:28px">A</span><span class="lbl" style="font-size:13px">a@example.com</span></div>')

def nav_badge(dev):
    if dev == 'desktop':
        side = (f'<nav class="s-side"><div class="brand">{ic("mailcheck","style=\"width:22px;height:22px\"")}DeclutrMail</div>{navrows("brief")}'
                f'<div class="sp"></div>{FOOTROWS}</nav>')
        head = PRO_HEAD_D
        main = (f'<div class="s-main"><div class="s-top"><span class="kicker">Catch up</span><div class="icons"><span class="ib">{ic("help")}</span><span class="ib">{ic("moon")}</span><span class="ib"><span class="avatar" style="width:30px;height:30px">A</span></span></div></div>'
                f'<div class="s-tabs">' + ''.join(f'<span class="{"on" if on else ""}">{t}{(" " + b) if b else ""}</span>' for t,b,on in CATCH_TABS_D) + '</div>'
                f'<div class="s-page">{head}{pro_panel()}</div></div>')
        return doc('Pro nav badge · desktop', f'<div class="s-shell">{side}{main}</div>' + badge('right:14px;bottom:12px'), 1440, 900, 'light')
    drawer = (f'<div class="scrim"></div><nav class="drawer" aria-label="All screens"><div style="display:flex;align-items:center;justify-content:space-between;height:48px;padding:0 4px 0 8px;margin-bottom:4px">'
              f'<span style="display:flex;align-items:center;gap:10px;color:var(--dm-nav-fg);font-family:var(--dm-font-display);font-size:20px;font-weight:500">{ic("mailcheck","style=\"width:22px;height:22px\"")}DeclutrMail</span>'
              f'<span style="width:44px;height:44px;display:grid;place-items:center;color:var(--dm-nav-fg)" aria-label="Close menu">{ic("x")}</span></div>'
              f'{navrows("home")}<div style="flex:1"></div>{FOOTROWS}</nav>')
    body = phead_m() + report_full_m()
    return doc('Pro nav badge · mobile drawer', m_shell('home', body, overlay=drawer, badgepos='left:20px;bottom:180px'), 390, 844, 'light')

# ── caught-up pattern ─────────────────────────────────────
def caught(title, line, action, mobile):
    btn_m = f'<button class="btn btn-primary" data-primary style="width:100%;margin-top:18px">{action}</button>' if action else ''
    btn_d = f'<button class="btn btn-primary" data-primary style="margin-top:20px">{action}</button>' if action else ''
    if mobile:
        return (f'<section class="card2" style="padding:28px 20px 22px;text-align:center;display:flex;flex-direction:column;align-items:center">'
                f'<div class="iconcirc">{ni("check",20)}</div><h2 class="h2s" style="margin-top:14px">{title}</h2>'
                f'<p class="body" style="margin:6px 0 0;max-width:300px">{line}</p>{btn_m}</section>')
    return (f'<section class="card2" style="padding:56px 40px 48px;text-align:center;display:flex;flex-direction:column;align-items:center;max-width:640px;margin:24px auto 0">'
            f'<div class="iconcirc">{ni("check",20)}</div><h2 class="h2s" style="margin-top:16px">{title}</h2>'
            f'<p class="body" style="margin:6px 0 0;max-width:460px">{line}</p>{btn_d}</section>')

CLEAN_TABS = [('Senders','',False),('Triage','',True),('Screener',PLUS_SUB,False)]
SCREENER_TABS = [('Senders','',False),('Triage','',False),('Screener','',True)]   # a Plus workspace: no lock badge
LATER_TABS_FREE = [('Later','',True),('Daily Brief',PRO_SUB,False),('Follow-ups',PRO_SUB,False)]
FOLLOWUPS_TABS_PRO = [('Later','',False),('Daily Brief','',False),('Follow-ups','',True)]   # Pro workspace only (A1)
CAUGHT = {
  # Content §6 / A1, word for word
  'triage':    ('Triage', 'Today’s senders · one choice each', 'Nothing needs a decision right now', 'New suggestions appear as senders email you again.', 'Browse senders', 'cleanup', 'Cleanup', CLEAN_TABS),
  'screener':  ('Screener', None, 'No new senders waiting', 'New senders show up here for review. Their email keeps arriving in Gmail until you decide.', 'See all senders', 'cleanup', 'Cleanup', SCREENER_TABS),
  'later':     ('Later', None, 'Nothing in Later', 'Move a sender to Later from Senders or Triage. Their email waits under the DeclutrMail/Later label in Gmail, then returns to your inbox at the time you pick.', 'See your senders', 'catchup', 'Catch up', LATER_TABS_FREE),
  'followups': ('Follow-ups', None, 'No follow-ups right now', 'None of your sent email looks like it’s waiting on a reply.', None, 'catchup', 'Catch up', FOLLOWUPS_TABS_PRO),
}
def caught_screen(kind, dev, theme):
    h1, sub, t, line, act, nav, loc, tabs = CAUGHT[kind]
    subh = f'<p class="sub">{sub}</p>' if sub else ''
    if dev == 'desktop':
        head = f'<div class="phead" style="margin-bottom:8px"><div><h1 class="h1">{h1}</h1>{subh}</div></div>'
        return doc(f'Caught up · {kind} · desktop', d_shell(nav, loc, head + caught(t, line, act, False), tabs), 1440, 900, theme)
    head = f'<div style="margin:2px 0 14px"><h1 class="h1">{h1}</h1>{subh}</div>'
    return doc(f'Caught up · {kind} · mobile', m_shell(nav, head + caught(t, line, act, True), tabs), 390, 844, theme)
def caught_up(dev, theme):
    return caught_screen('triage' if dev == 'desktop' else 'screener', dev, theme)

# ── A5 info popover (mobile bottom sheet) ─────────────────
INFO_BODY = 'Less than 10% of their email was marked read in Gmail in the last 90 days. Gmail only tells us whether email is marked read. It can’t tell whether you looked at it.'
def unread_info(theme):
    sheet = ('<div class="scrim"></div><div role="dialog" aria-modal="true" aria-label="What “mostly leave unread” means" '
             'style="position:absolute;left:0;right:0;bottom:0;z-index:30;background:var(--dm-card);border-radius:20px 20px 0 0;padding:10px 20px 28px;box-shadow:0 -8px 30px #0003">'
             '<div style="width:36px;height:4px;border-radius:2px;background:var(--dm-line);margin:0 auto 14px"></div>'
             f'<p class="body" style="font-size:15px;line-height:1.5;color:var(--dm-fg);margin:0">{INFO_BODY}</p>'
             '<button class="btn btn-quiet" style="width:100%;margin-top:18px">Close</button></div>')
    body = phead_m() + report_full_m() + nextbest_m()
    return doc('Home · unread info · mobile', m_shell('home', body, overlay=sheet, badgepos='left:20px;top:60px'), 390, 844, theme)

FILES = {}
for st in ['full','calm','empty','scan-failed']:
    for dv in ['desktop','mobile']:
        for th in ['light','dark']:
            FILES[f'home-{st}-{dv}-{th}.html'] = (lambda st=st,dv=dv,th=th: home(st,dv,th))
for dv in ['desktop','mobile']:
    FILES[f'pattern-pro-locked-{dv}-light.html'] = (lambda dv=dv: pro_locked(dv))
    FILES[f'pattern-pro-nav-badge-{dv}-light.html'] = (lambda dv=dv: nav_badge(dv))
    for th in ['light','dark']:
        FILES[f'pattern-caught-up-{dv}-{th}.html'] = (lambda dv=dv,th=th: caught_up(dv,th))
        for kd in ['later','followups']:
            FILES[f'pattern-caught-up-{kd}-{dv}-{th}.html'] = (lambda kd=kd,dv=dv,th=th: caught_screen(kd,dv,th))

for th in ['light','dark']:
    FILES[f'pattern-unread-info-mobile-{th}.html'] = (lambda th=th: unread_info(th))

if __name__ == '__main__':
    only = set(sys.argv[1:])
    for f, fn in FILES.items():
        if only and f not in only: continue
        open(os.path.join(HERE, f), 'w').write(fn())
    print(len(FILES), 'files')
