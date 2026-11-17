export const themes = ['system', 'dark', 'light'] as const;
export const accents = ['green', 'blue', 'violet', 'rose', 'amber'] as const;

export type Theme = (typeof themes)[number];
export type Accent = (typeof accents)[number];

export const defaultTheme: Theme = 'system';
export const defaultAccent: Accent = 'green';

const storageKey = 'repo-surgeon.appearance';

// This runs before the layout displays the page and uses only the allowed palette IDs.
export const appearanceScript = `
(() => {
  const key = ${JSON.stringify(storageKey)};
  const root = document.documentElement;
  function restore() {
    let preference;
    try {
      preference = JSON.parse(window.localStorage.getItem(key) ?? 'null');
    } catch {}
    root.dataset.theme = ${JSON.stringify(themes)}.includes(preference?.theme)
      ? preference.theme
      : ${JSON.stringify(defaultTheme)};
    root.dataset.accent = ${JSON.stringify(accents)}.includes(preference?.accent)
      ? preference.accent
      : ${JSON.stringify(defaultAccent)};
  }
  restore();
  window.addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) restore();
  });
})();
`;

export function currentTheme(): Theme {
  return themes.find((theme) => theme === document.documentElement.dataset.theme) ?? defaultTheme;
}

export function currentAccent(): Accent {
  return (
    accents.find((accent) => accent === document.documentElement.dataset.accent) ?? defaultAccent
  );
}

export function subscribeToAppearance(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ['data-theme', 'data-accent'] });
  return () => observer.disconnect();
}

export function setAppearance(theme: Theme, accent: Accent) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.accent = accent;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ theme, accent }));
  } catch {
    // Browser storage may be unavailable. The current page can still apply the choice.
  }
}
