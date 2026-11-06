import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import localFont from 'next/font/local';
import { Brand, Icon } from '@/components/ui/shell';
import { CircuitField } from '@/components/ui/circuit-field';
import { InspectionMark } from './inspection-mark';
import desktop from './workspace-desktop.png';
import phone from './workspace-phone.png';
import styles from './landing.module.css';

const display = localFont({
  src: './IBMPlexSans.ttf',
  weight: '100 700',
  display: 'swap',
  variable: '--font-landing-display',
});

export const metadata: Metadata = {
  title: 'Repo Surgeon - Inspect the repo. Keep control.',
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
        <section className={styles.heroSurface} aria-labelledby="landing-title">
          <CircuitField />
          <div className={`${styles.wrap} ${styles.hero}`}>
            <div className={styles.heroCopy}>
              <h1 id="landing-title" className={styles.headline}>
                Inspect the repo.
                <br />
                <span className={styles.titleAccent}>
                  Keep control.
                  <span aria-hidden="true" className={styles.textSeam}>
                    Keep control.
                  </span>
                </span>
              </h1>
              <p className={styles.intro}>
                A read-only repository workspace. Inspect within clear boundaries, follow the
                activity, and pick up where you left off. Your source files stay yours.
              </p>
              <div className={styles.heroActions}>
                <Link href="/" className={styles.primary}>
                  Open workspace
                  <Icon name="arrow" />
                </Link>
                <a className={styles.secondary} href="#workspace">
                  See the workspace
                  <Icon name="arrow" />
                </a>
              </div>
              <span className={styles.finePrint}>Early release · deterministic demo provider</span>
            </div>
            <div className={styles.heroArt}>
              <InspectionMark />
            </div>
          </div>
        </section>
        <section className={styles.wrap} id="workspace" aria-labelledby="workspace-title">
          <div className={styles.productView} data-visual="workspace">
            <div className={styles.productToolbar}>
              <h2 id="workspace-title">The read-only workspace</h2>
              <span>Synthetic demo data</span>
            </div>
            <Image
              className={styles.desktopImage}
              src={desktop}
              alt="Repo Surgeon desktop workspace with repository selection, a saved demo exchange and persisted run events."
              sizes="(min-width: 1408px) 1280px, (min-width: 1101px) calc(100vw - 128px), calc(100vw - 80px)"
              loading="eager"
            />
            <Image
              className={styles.phoneImage}
              src={phone}
              alt="Repo Surgeon phone workspace with a saved demo exchange, inspection composer, and repository and event drawer buttons."
              sizes="calc(100vw - 40px)"
              loading="eager"
            />
          </div>
        </section>
        <section className={`${styles.wrap} ${styles.workflow}`} aria-labelledby="workflow-title">
          <div className={styles.sectionHead}>
            <h2 id="workflow-title">
              The repository.
              <br />
              The run. The record.
            </h2>
            <p>
              A deliberately small first step, with the context in one place. Source files stay
              unchanged throughout.
            </p>
          </div>
          <ol className={styles.steps}>
            <li>
              <h3>Select a repository</h3>
              <p>
                Sign in with GitHub and choose a repository already assigned to your account. Start
                a session in a bounded, read-only workspace.
              </p>
            </li>
            <li>
              <h3>Follow the inspection</h3>
              <p>
                Run the deterministic demo provider. See the tool outcome and the saved run events
                alongside the exchange.
              </p>
            </li>
            <li>
              <h3>Return to the context</h3>
              <p>
                Reopen a saved session to revisit its latest exchange and activity. Saving a run
                does not mean every step succeeded.
              </p>
            </li>
          </ol>
        </section>
        <section
          className={`${styles.wrap} ${styles.release}`}
          id="release"
          aria-labelledby="release-title"
        >
          <div className={styles.releaseLead}>
            <h2 id="release-title">The current boundary.</h2>
            <p>
              Working sessions and saved activity. A demo provider, with its limits in plain sight.
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
            Start with
            <br />a closer look.
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
