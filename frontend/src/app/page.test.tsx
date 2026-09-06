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
});
