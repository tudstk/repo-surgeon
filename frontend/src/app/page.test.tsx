import { act, fireEvent, render, screen } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import Home from './page';

describe('Home', () => {
  it('renders workspace landmarks and the human-control boundary', () => {
    render(<Home />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Understand the code. Keep people in control.',
    );
    expect(screen.getByRole('navigation', { name: 'Workspace map' })).toBeInTheDocument();
    expect(
      screen.getByRole('complementary', { name: 'Repositories and Git lineage' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Conversation & agent trace' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Work panel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Staging Chamber' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('option', { name: 'payments-api' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: 'payments-api' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('option', { name: /Refactor session module/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText(/WRITE PENDING/i)).toBeInTheDocument();
    expect(screen.getByText(/NOT touched local repository disk/i)).toBeInTheDocument();
    expect(screen.getByText(/Sandbox Tests: 14 passing/i)).toBeInTheDocument();
  });

  it('labels static controls as unavailable and keeps the preview composer inert', () => {
    render(<Home />);

    expect(screen.getByRole('button', { name: 'Send instruction (preview only)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Switch repository' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Staging Chamber' })).toBeDisabled();

    const composer = screen.getByRole('textbox', { name: 'Agent instruction' });
    expect(composer).toHaveAttribute('readonly');
    expect(composer).toHaveAccessibleDescription(
      'Preview only. This field is read-only and cannot send instructions.',
    );
    const form = composer.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
  });

  it('marks preview-only operational facts for assistive technology', () => {
    render(<Home />);

    expect(screen.getByLabelText('Health: illustrative static preview')).toHaveTextContent(
      'HEALTHY (PREVIEW)',
    );
    expect(screen.getByLabelText('Sandbox HEAD: illustrative static preview')).toHaveTextContent(
      '9b4ec8f (PREVIEW)',
    );
    expect(screen.getByText(/GIT DAG LINEAGE \(STATIC PREVIEW\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/INDEX 47b91e\.\.\.c892fa 100644 \(STATIC PREVIEW\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/pgvector.*\(PREVIEW\)/)).toBeInTheDocument();
    expect(screen.getByText(/Sandbox Tests: 14 passing/)).toHaveTextContent('STATIC PREVIEW');
  });

  it('hides commit nodes from assistive technology because they are decorative', () => {
    render(<Home />);

    expect(
      screen
        .getAllByRole('generic', { hidden: true })
        .filter((element) => element.matches('.commit > i')),
    ).toHaveLength(2);
    expect(document.querySelectorAll('.commit > i[aria-hidden="true"]')).toHaveLength(2);
  });

  it('uses the stacked layout at the 960px tablet width', () => {
    const originalWidth = window.innerWidth;
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 960 });
    window.matchMedia = ((query: string) => ({
      matches: query === '(max-width: 1024px)',
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;

    render(<Home />);

    expect(screen.getByRole('main').querySelector('.workspace-grid')).toHaveAttribute(
      'data-layout',
      'stacked',
    );
    expect(screen.queryAllByRole('separator')).toHaveLength(0);

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    window.matchMedia = originalMatchMedia;
  });

  it('resizes adjacent panes with bounded pointer and keyboard input', () => {
    render(<Home />);

    const firstSeparator = screen.getByRole('separator', {
      name: 'Resize Workspace map and Repositories and Git lineage',
    });
    expect(firstSeparator).toHaveAttribute('aria-valuenow', '200');

    fireEvent.keyDown(firstSeparator, { key: 'ArrowRight' });
    expect(firstSeparator).toHaveAttribute('aria-valuenow', '216');

    fireEvent.pointerDown(firstSeparator, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 500 });
    fireEvent.pointerUp(window);
    expect(firstSeparator).toHaveAttribute('aria-valuenow', '250');
    expect(Number(firstSeparator.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(
      Number(firstSeparator.getAttribute('aria-valuemax')),
    );
  });

  it.each([1285, 1440])(
    'keeps all three separators interactive at %dpx and conserves each adjacent pair',
    (viewportWidth) => {
      const originalWidth = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });
      render(<Home />);

      const separators = screen.getAllByRole('separator');
      expect(separators).toHaveLength(3);

      for (const separator of separators) {
        const min = Number(separator.getAttribute('aria-valuemin'));
        const max = Number(separator.getAttribute('aria-valuemax'));
        expect(max).toBeGreaterThan(min);

        const initial = Number(separator.getAttribute('aria-valuenow'));
        fireEvent.keyDown(separator, { key: 'ArrowRight' });
        expect(Number(separator.getAttribute('aria-valuenow'))).toBeGreaterThan(initial);

        fireEvent.keyDown(separator, { key: 'Home' });
        expect(separator).toHaveAttribute('aria-valuenow', String(min));
        fireEvent.keyDown(separator, { key: 'End' });
        expect(separator).toHaveAttribute('aria-valuenow', String(max));

        const beforeDrag = Number(separator.getAttribute('aria-valuenow'));
        fireEvent.pointerDown(separator, { clientX: 400 });
        fireEvent.pointerMove(window, { clientX: 420 });
        fireEvent.pointerUp(window);
        expect(Number(separator.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(beforeDrag);
        expect(Number(separator.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(max);
      }

      for (const separator of separators) {
        const current = Number(separator.getAttribute('aria-valuenow'));
        expect(current).toBeGreaterThanOrEqual(Number(separator.getAttribute('aria-valuemin')));
        expect(current).toBeLessThanOrEqual(Number(separator.getAttribute('aria-valuemax')));
      }

      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    },
  );

  it('cleans pointer listeners on cancellation and unmount', () => {
    const { unmount } = render(<Home />);
    const separator = screen.getAllByRole('separator')[0];

    fireEvent.pointerDown(separator, { clientX: 100 });
    fireEvent.pointerCancel(window);
    fireEvent.pointerMove(window, { clientX: 500 });
    expect(separator).toHaveAttribute('aria-valuenow', '200');

    fireEvent.pointerDown(separator, { clientX: 100 });
    unmount();
    fireEvent.pointerMove(window, { clientX: 500 });
    fireEvent.pointerUp(window);
  });

  it('associates the complete workspace with its static-preview boundary', () => {
    render(<Home />);

    expect(screen.getByRole('main')).toHaveAccessibleDescription(
      /entire workspace is an illustrative static preview/i,
    );
    expect(screen.getByRole('option', { name: 'payments-api' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: /Refactor session module/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it.each([1025, 1100, 1101, 1284, 1440])(
    'hydrates without changing separator markup at %dpx before layout synchronization',
    async (viewportWidth) => {
      const originalWidth = window.innerWidth;
      const originalMatchMedia = window.matchMedia;
      const originalError = console.error;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      })) as typeof window.matchMedia;
      const errors: unknown[] = [];
      console.error = (...args: unknown[]) => errors.push(args);

      const container = document.createElement('div');
      document.body.appendChild(container);
      const serverMarkup = renderToString(<Home />);
      expect(serverMarkup).toContain('role="separator"');
      container.innerHTML = serverMarkup;
      let root: ReturnType<typeof hydrateRoot>;
      await act(async () => {
        root = hydrateRoot(container, <Home />);
        await Promise.resolve();
      });

      expect(errors).toEqual([]);
      expect(container.querySelectorAll('[role="separator"]')).toHaveLength(3);
      root!.unmount();
      container.remove();
      console.error = originalError;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
      window.matchMedia = originalMatchMedia;
    },
  );
});
