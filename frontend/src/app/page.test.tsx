import { render, screen } from '@testing-library/react';

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
    expect(screen.getByText(/WRITE PENDING/i)).toBeInTheDocument();
    expect(screen.getByText(/NOT touched local repository disk/i)).toBeInTheDocument();
    expect(screen.getByText(/Sandbox Tests: 14 passing/i)).toBeInTheDocument();
  });
});
