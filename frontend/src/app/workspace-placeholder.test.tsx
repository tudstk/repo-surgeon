import { render, screen } from '@testing-library/react';

import WorkspacePlaceholder from './workspace-placeholder';

describe('WorkspacePlaceholder', () => {
  it.each([
    ['/git-graph-staging', 'Git Graph & Staging'],
    ['/agent-traces-stream', 'Agent Traces & Stream'],
    ['/worktrees-locks', 'Worktrees & Locks'],
    ['/audit-ledger', 'Audit Ledger'],
  ])('renders %s as a keyboard-navigable destination', (path, title) => {
    render(<WorkspacePlaceholder path={path} title={title} />);

    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: title })).toHaveAttribute('href', path);
    expect(screen.getByRole('link', { name: title })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText(/STATIC PREVIEW|\(PREVIEW\)/i)).not.toBeInTheDocument();
  });
});
