/**
 * The marketing CSP already permits inline scripts. Keep this tiny resolver
 * before first paint without making the parser wait for a separate request.
 * Authenticated layouts continue using the nonced external asset.
 */
export const THEME_INIT_SOURCE = `(function(){try{var t=localStorage.getItem('dm-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch{document.documentElement.setAttribute('data-theme','light');}})();`;
