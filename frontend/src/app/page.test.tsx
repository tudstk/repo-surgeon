import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { vi } from 'vitest';

import Home from './page';

describe('Home', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input, init) =>
        Promise.resolve(
          new Response(
            init?.method === 'POST'
              ? JSON.stringify({
                  match_count: 1,
                  matches: [
                    {
                      path: 'auth/session.py',
                      line: 52,
                      text: 'async def resolve(self, token: str) -> Optional<SessionData>:',
                      before: [{ number: 51, text: 'class SessionManager:' }],
                      after: [{ number: 53, text: '    return session' }],
                    },
                  ],
                  truncated: false,
                  duration_ms: 38,
                  skipped_files: 0,
                })
              : input.endsWith('/summary')
                ? JSON.stringify({
                    language: 'Python',
                    language_confidence: 'high',
                    file_count: 342,
                    approximate_lines: 28000,
                    test_framework: 'pytest',
                    test_command: 'pytest -q',
                    truncated: false,
                  })
                : JSON.stringify([
                    {
                      id: 'repository-1',
                      name: 'payments-api',
                    },
                  ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('renders workspace landmarks and the human-control boundary', async () => {
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
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'payments-api' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(screen.getByRole('option', { name: 'payments-api' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('option', { name: /Refactor session module/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('textbox', { name: 'Agent instruction' })).toHaveValue(
      'Why do users get logged out after their session expires?',
    );
    expect(screen.getByText(/WRITE PENDING/i)).toBeInTheDocument();
    expect(screen.getByText(/NOT touched local repository disk/i)).toBeInTheDocument();
    expect(screen.getByText(/Sandbox Tests: 14 passing/i)).toBeInTheDocument();
  });

  it('keeps read-only controls unavailable and the composer inert', async () => {
    render(<Home />);

    expect(screen.getByRole('button', { name: 'Send instruction' })).toBeDisabled();
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'payments-api' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(screen.getByRole('button', { name: 'Staging Chamber' })).toBeDisabled();

    const composer = screen.getByRole('textbox', { name: 'Agent instruction' });
    expect(composer).not.toHaveAttribute('readonly');
    expect(composer).toHaveAccessibleDescription(
      'Investigation is read-only and cannot modify the connected repository.',
    );
    const form = composer.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
  });

  it('does not render preview labels while preserving operational facts', () => {
    render(<Home />);

    expect(screen.getByLabelText('Health: healthy')).toHaveTextContent('HEALTHY');
    expect(screen.getByLabelText('Sandbox HEAD')).toHaveTextContent('9b4ec8f');
    expect(screen.getByText('GIT DAG LINEAGE')).toBeInTheDocument();
    expect(screen.getByText(/INDEX 47b91e\.\.\.c892fa 100644/)).toBeInTheDocument();
    expect(screen.getByText('Repository summary unavailable.')).toBeInTheDocument();
    expect(screen.queryByText(/STATIC PREVIEW|\(PREVIEW\)/i)).not.toBeInTheDocument();
  });

  it('renders repository-derived summary data from the selected repository API', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
    const fetchMock = vi.fn((input: string) =>
      Promise.resolve(
        new Response(
          input.endsWith('/summary')
            ? JSON.stringify({
                language: 'Go',
                language_confidence: 'high',
                file_count: 3,
                approximate_lines: 42,
                test_framework: 'go test',
                test_command: 'go test ./...',
                truncated: false,
              })
            : JSON.stringify([{ id: 'repository-1', name: 'go-service' }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<Home />);

    await waitFor(() => expect(screen.getByText(/3 files · 42 LOC/i)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/repositories',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/repositories/repository-1/summary',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('opens the exact cited context in the work panel', async () => {
    render(<Home />);

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'auth/session.py:51-53' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('link', { name: 'auth/session.py:51-53' }));

    expect(screen.getByRole('region', { name: 'Work panel' })).toHaveTextContent('auth/session.py');
    expect(screen.getByRole('region', { name: 'Work panel' })).toHaveTextContent('L51-53');
    expect(screen.getByRole('region', { name: 'Work panel' })).toHaveTextContent(
      'class SessionManager:',
    );
    expect(screen.getByRole('region', { name: 'Work panel' })).toHaveTextContent('return session');
    expect(screen.getByRole('tab', { name: /Code/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('highlights the matched line within investigation evidence context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input, init) => {
        if (init?.method === 'POST' && input.toString().includes('/investigations')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                status: 'complete',
                question: 'Why?',
                summary: 'Evidence found.',
                hypotheses: [
                  {
                    rank: 1,
                    title: 'Expiry path',
                    explanation: 'The retrieved code is a lead.',
                    confidence: 'medium',
                    evidence: [
                      {
                        citation_id: 'search-investigation-1-1',
                        path: 'session.py',
                        match_line: 52,
                        start_line: 51,
                        end_line: 53,
                        label: 'session.py:51-53',
                        excerpt: 'class SessionState:\ndef expire(session, token):\n  return token',
                      },
                    ],
                    verification_suggestions: ['Add a regression test.'],
                  },
                ],
                events: [],
                model_calls: 0,
                tool_calls: 1,
                returned_bytes: 100,
                stop_reason: null,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify(
              input.toString().endsWith('/summary')
                ? {
                    language: 'Python',
                    language_confidence: 'high',
                    file_count: 1,
                    approximate_lines: 3,
                    test_framework: 'pytest',
                    test_command: 'pytest -q',
                    truncated: false,
                  }
                : input.toString().endsWith('/search')
                  ? {
                      match_count: 1,
                      matches: [
                        {
                          path: 'auth/session.py',
                          line: 52,
                          text: 'async def resolve(self, token: str):',
                          before: [],
                          after: [],
                        },
                      ],
                      truncated: false,
                      duration_ms: 1,
                      skipped_files: 0,
                    }
                  : [{ id: 'repository-1', name: 'payments-api' }],
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }),
    );

    render(<Home />);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'payments-api' })).toBeInTheDocument(),
    );
    fireEvent.submit(screen.getByRole('textbox', { name: 'Agent instruction' }).closest('form')!);
    await waitFor(() => expect(screen.getByText('Expiry path')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'auth/session.py:52' })).not.toBeInTheDocument();
    expect(screen.queryByText(/WRITE PENDING/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/proposing patch revision/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\+7 −5/)).not.toBeInTheDocument();
    expect(screen.queryByText('SPLIT')).not.toBeInTheDocument();
    expect(screen.queryByText('UNIFIED')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Tests/ })).not.toBeInTheDocument();
    expect(screen.getByText(/READ-ONLY INVESTIGATION/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: /session.py:51-53/ }));

    const citedLine = screen.getByText('def expire(session, token):').closest('.cited-line');
    expect(citedLine).toHaveTextContent('52');
    expect(citedLine).toHaveClass('cited-line');
  });

  it('clears an investigation error when switching repositories', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input, init) => {
        if (init?.method === 'POST' && input.toString().includes('/investigations')) {
          return Promise.resolve(new Response(null, { status: 500 }));
        }
        return Promise.resolve(
          new Response(
            JSON.stringify(
              input.toString().endsWith('/summary')
                ? {
                    language: null,
                    language_confidence: 'unknown',
                    file_count: 0,
                    approximate_lines: null,
                    test_framework: null,
                    test_command: null,
                    truncated: false,
                  }
                : input.toString().endsWith('/search')
                  ? {
                      match_count: 0,
                      matches: [],
                      truncated: false,
                      duration_ms: 1,
                      skipped_files: 0,
                    }
                  : [
                      { id: 'repository-1', name: 'payments-api' },
                      { id: 'repository-2', name: 'web-dashboard' },
                    ],
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }),
    );

    render(<Home />);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'payments-api' })).toBeInTheDocument(),
    );
    fireEvent.submit(screen.getByRole('textbox', { name: 'Agent instruction' }).closest('form')!);
    await waitFor(() => expect(screen.getByText(/Investigation unavailable/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('option', { name: 'web-dashboard' }));

    await waitFor(() =>
      expect(screen.queryByText(/Investigation unavailable/)).not.toBeInTheDocument(),
    );
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

  it('clears desktop inline widths at a narrow mobile width', () => {
    const originalWidth = window.innerWidth;
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
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

    const grid = screen.getByRole('main').querySelector('.workspace-grid');
    expect(grid).toHaveAttribute('data-layout', 'stacked');
    expect(grid).not.toHaveAttribute('style');
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

  it('exposes the workspace safety boundary without preview labeling', async () => {
    render(<Home />);

    expect(screen.getByText(/READ-ONLY \(SAFE SANDBOX\)/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'payments-api' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
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
