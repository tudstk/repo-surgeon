import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GitHubRepositoryPicker } from './github-repository-picker';

it('keeps only the current query suggestions when an earlier request finishes late', async () => {
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
  const { unmount } = render(<GitHubRepositoryPicker onClose={() => {}} />);
  try {
    const search = screen.getByRole('searchbox', { name: 'Search GitHub' });
    fireEvent.change(search, { target: { value: 'flask' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 1500 });
    fireEvent.change(search, { target: { value: 'node' } });
    expect(
      await screen.findByRole('link', { name: /nodejs\/node/ }, { timeout: 1500 }),
    ).toHaveAttribute('href', 'https://github.com/nodejs/node');
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
    await act(async () => {
      finishFirst?.(Response.json([{ full_name: 'pallets/flask', owner_avatar_url: null }]));
      await firstResponse;
    });
    expect(screen.queryByRole('link', { name: /pallets\/flask/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /nodejs\/node/ })).toBeInTheDocument();
  } finally {
    unmount();
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
    vi.unstubAllGlobals();
  }
});
