import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GitHubRepositoryPicker } from './github-repository-picker';

beforeEach(() => {
  // jsdom does not implement the native dialog methods. The browser suite checks modal behavior.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  vi.unstubAllGlobals();
});

it('keeps only the current query suggestions when an earlier request finishes late', async () => {
  let finishFirst: ((response: Response) => void) | undefined;
  const firstResponse = new Promise<Response>((resolve) => {
    finishFirst = resolve;
  });
  const fetchMock = vi.fn((url: string, init: RequestInit) => {
    init.signal?.throwIfAborted();
    return url.endsWith('q=flask')
      ? firstResponse
      : Promise.resolve(Response.json([{ full_name: 'nodejs/node', owner_avatar_url: null }]));
  });
  vi.stubGlobal('fetch', fetchMock);
  const { unmount } = render(
    <GitHubRepositoryPicker onClose={() => {}} onImported={() => {}} csrfToken="fixture" />,
  );
  try {
    const search = screen.getByRole('searchbox', { name: 'Search GitHub' });
    fireEvent.change(search, { target: { value: 'flask' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 1500 });
    fireEvent.change(search, { target: { value: 'node' } });
    expect(
      await screen.findByRole('button', { name: /nodejs\/node/ }, { timeout: 1500 }),
    ).toBeEnabled();
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
    await act(async () => {
      finishFirst?.(Response.json([{ full_name: 'pallets/flask', owner_avatar_url: null }]));
      await firstResponse;
    });
    expect(screen.queryByRole('button', { name: /pallets\/flask/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /nodejs\/node/ })).toBeInTheDocument();
  } finally {
    unmount();
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
    vi.unstubAllGlobals();
  }
});

it('keeps failed imports recoverable, sends CSRF, and prevents duplicate submissions', async () => {
  const imported = { id: 'imported-1', name: 'pallets/flask', github_commit: 'a'.repeat(40) };
  const onImported = vi.fn();
  const onClose = vi.fn();
  let finishImport: ((response: Response) => void) | undefined;
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return new Promise<Response>((resolve) => {
        finishImport = resolve;
      });
    }
    return Promise.resolve(Response.json([{ full_name: 'pallets/flask', owner_avatar_url: null }]));
  });
  vi.stubGlobal('fetch', fetchMock);
  const { unmount } = render(
    <GitHubRepositoryPicker csrfToken="fixture-csrf" onClose={onClose} onImported={onImported} />,
  );
  try {
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pallets/flask' } });
    const result = await screen.findByRole(
      'button',
      { name: 'Import pallets/flask' },
      { timeout: 1500 },
    );
    fireEvent.click(result);
    fireEvent.click(result);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/repositories/github/import',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'fixture-csrf' },
        body: JSON.stringify({ full_name: 'pallets/flask' }),
      }),
    );
    expect(screen.getByRole('searchbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close repository search' })).toBeDisabled();
    await act(async () =>
      finishImport?.(Response.json({ code: 'github_import_failed' }, { status: 422 })),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Import failed');
    expect(result).toBeEnabled();
    expect(onImported).not.toHaveBeenCalled();
    fireEvent.click(result);
    await act(async () => finishImport?.(Response.json(imported)));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(imported));
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  } finally {
    unmount();
  }
});
