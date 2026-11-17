'use client';

import { useSyncExternalStore } from 'react';
import { AppHeader, Icon } from '@/components/ui/shell';
import type { SafeProfile } from '@/lib/auth-api';
import {
  accents,
  currentAccent,
  currentTheme,
  defaultAccent,
  defaultTheme,
  setAppearance,
  subscribeToAppearance,
  themes,
} from '@/lib/appearance';
import styles from './personalization.module.css';

function optionName(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}

export function Personalization({ user }: { user: SafeProfile }) {
  const theme = useSyncExternalStore(subscribeToAppearance, currentTheme, () => defaultTheme);
  const accent = useSyncExternalStore(subscribeToAppearance, currentAccent, () => defaultAccent);

  return (
    <main className="profile-shell">
      <AppHeader active="settings" user={user} />
      <div className={styles.settings}>
        <h1>Settings</h1>
        <div className={styles.layout}>
          <nav aria-label="Settings sections" className={styles.sections}>
            <a href="#personalization" aria-current="location">
              <Icon name="personalization" />
              Personalization
            </a>
          </nav>
          <section
            id="personalization"
            className={styles.panel}
            tabIndex={-1}
            aria-labelledby="personalization-title"
          >
            <header className={styles.panelHeader}>
              <h2 id="personalization-title">Personalization</h2>
              <p>Changes apply immediately in this browser.</p>
            </header>
            <fieldset aria-describedby="theme-description" className={styles.themeGroup}>
              <legend>Theme</legend>
              <p id="theme-description">System follows your device’s appearance.</p>
              <div className={styles.themes}>
                {themes.map((option) => (
                  <label className={styles.themeChoice} key={option}>
                    <span
                      className={styles.preview}
                      data-theme-preview={option}
                      data-accent={accent}
                      aria-hidden="true"
                    >
                      <span className={styles.previewHeader} />
                      <span className={styles.previewSidebar} />
                      <span className={styles.previewContent} />
                    </span>
                    <span className={styles.themeLabel}>
                      <input
                        type="radio"
                        name="theme"
                        value={option}
                        checked={theme === option}
                        onChange={() => setAppearance(option, currentAccent())}
                      />
                      {optionName(option)}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className={styles.accentGroup}>
              <legend>Accent color</legend>
              <div className={styles.accents}>
                {accents.map((option) => (
                  <label className={styles.accentChoice} key={option} data-accent={option}>
                    <input
                      type="radio"
                      name="accent"
                      value={option}
                      checked={accent === option}
                      onChange={() => setAppearance(currentTheme(), option)}
                    />
                    <span className={styles.swatch} aria-hidden="true">
                      <Icon name="check" />
                    </span>
                    {optionName(option)}
                  </label>
                ))}
              </div>
            </fieldset>
          </section>
        </div>
      </div>
    </main>
  );
}
