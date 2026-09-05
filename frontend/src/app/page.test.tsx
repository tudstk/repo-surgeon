import { fireEvent, render, screen } from '@testing-library/react';

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
    const form = composer.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
  });
});
