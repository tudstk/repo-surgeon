import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import localFont from 'next/font/local';
import { Brand, Icon } from '@/components/ui/shell';
import { FaultTitle } from './fault-title';
import desktop from './workspace-desktop.png';
import phone from './workspace-phone.png';
import styles from './landing.module.css';

const display = localFont({
  src: './BarlowCondensed-SemiBold.ttf',
  weight: '600',
  display: 'swap',
  variable: '--font-landing-display',
});

export const metadata: Metadata = {
  title: 'Repo Surgeon - A careful first look at your code',
  description:
    'A human-controlled repository inspection workspace. Read-only sessions, saved activity, and a clear view of the current demo release.',
  other: { 'page-type': 'software', 'site-kind': 'software' },
};

export default function LandingPage() {
  return (
    <div className={`${styles.page} ${display.variable}`} id="top" data-type="software">
      <a className={styles.skipLink} href="#landing-content">
        Skip to content
      </a>
      <header className={`${styles.wrap} ${styles.header}`}>
        <Brand href="#top" />
        <nav aria-label="Landing navigation">
          <a className={styles.sectionLink} href="#workspace">
            The workspace
          </a>
          <a className={styles.sectionLink} href="#release">
            This release
          </a>
          <Link className={styles.headerAction} href="/">
            Open workspace
            <Icon name="arrow" />
          </Link>
        </nav>
      </header>
      <main id="landing-content" tabIndex={-1}>
        <section className={`${styles.wrap} ${styles.hero}`} aria-labelledby="landing-title">
          <FaultTitle />
          <div className={styles.heroFoot}>
            <div className={styles.heroStatement}>
              <p>
                Human-controlled
                <br />
                repository inspection.
              </p>
              <span className={styles.finePrint}>A careful first look. No surprise writes.</span>
            </div>
            <div className={styles.heroAction}>
              <p>
                Unfamiliar code deserves a closer look. Start with a read-only session. Keep the
                activity. Make the decisions.
              </p>
              <Link href="/" className={styles.primary}>
                Open workspace
                <Icon name="arrow" />
              </Link>
              <span className={styles.finePrint}>Early release · deterministic demo provider</span>
            </div>
          </div>
          <div className={styles.heroEdge}>
            <span>Source files stay unchanged</span>
            <a href="#workspace">
              Take a closer look
              <Icon name="arrow" />
            </a>
          </div>
        </section>
        <section
          className={`${styles.wrap} ${styles.product}`}
          id="workspace"
          aria-labelledby="workspace-title"
        >
          <div className={styles.sectionHead}>
            <h2 id="workspace-title">The workspace.</h2>
            <p>
              A real workspace for a deliberately small first step: choose an assigned repository,
              run a demo inspection, return to the saved exchange. Shown with synthetic demo data.
            </p>
          </div>
          <div className={styles.productView} data-visual="workspace">
            <Image
              className={styles.desktopImage}
              src={desktop}
              alt="Repo Surgeon desktop workspace with repository selection, a saved demo exchange and persisted run events."
              sizes="(min-width: 1440px) 1312px, calc(100vw - 80px)"
            />
            <Image
              className={styles.phoneImage}
              src={phone}
              alt="Repo Surgeon phone workspace with a saved demo exchange, inspection composer, and repository and event drawer buttons."
              sizes="calc(100vw - 40px)"
            />
          </div>
        </section>
        <section
          className={`${styles.wrap} ${styles.release}`}
          id="release"
          aria-labelledby="release-title"
        >
          <div className={styles.releaseLead}>
            <h2 id="release-title">
              A small release.
              <br />
              <span>A clear boundary.</span>
            </h2>
            <p>
              Sessions and events are saved.
              <br />
              Source files stay unchanged.
            </p>
          </div>
          <div className={styles.questions}>
            <details open>
              <summary>
                What can I do today?
                <Icon name="plus" />
              </summary>
              <p>
                Sign in with GitHub, select an assigned repository and create a read-only session.
                Run a bounded demo inspection, then revisit its latest exchange and saved events.
              </p>
            </details>
            <details>
              <summary>
                Does it answer questions with AI?
                <Icon name="plus" />
              </summary>
              <p>
                The current provider lists files and returns a fixed completion message. It does not
                generate a tailored answer to your question.
              </p>
            </details>
            <details>
              <summary>
                Does GitHub sign-in import repositories?
                <Icon name="plus" />
              </summary>
              <p>
                No. GitHub sign-in identifies your account. This release shows repositories already
                assigned to it; connecting or importing a GitHub repository is not available yet.
              </p>
            </details>
            <details>
              <summary>
                Can it change my code or run tests?
                <Icon name="plus" />
              </summary>
              <p>
                No. Proposals, sandbox test execution, approvals, applying changes and repository
                writes are not available in this release.
              </p>
            </details>
          </div>
        </section>
      </main>
      <footer className={`${styles.wrap} ${styles.footer}`}>
        <div className={styles.closeRow}>
          <h2>
            Your code.
            <br />
            <span>Still yours.</span>
          </h2>
          <div>
            <p>
              Start with a read-only inspection.
              <br />
              Leave your repository intact.
            </p>
            <Link className={styles.primary} href="/">
              Open workspace
              <Icon name="arrow" />
            </Link>
          </div>
        </div>
        <div className={styles.footerEdge}>
          <Brand href="#top" />
          <span>Built for a careful first look.</span>
          <a href="https://github.com/tudstk/repo-surgeon" target="_blank" rel="noreferrer">
            Source on GitHub
            <Icon name="arrow" />
          </a>
        </div>
      </footer>
    </div>
  );
}
