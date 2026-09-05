import { render, screen } from '@testing-library/react';

import Home from './page';

describe('Home', () => {
  it('communicates the local-first, human-controlled product boundary', () => {
    render(<Home />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Understand the code. Keep people in control.',
    );
    expect(screen.getByText('Apply by approval')).toBeInTheDocument();
    expect(screen.getByText(/not available yet/i)).toBeInTheDocument();
  });
});
