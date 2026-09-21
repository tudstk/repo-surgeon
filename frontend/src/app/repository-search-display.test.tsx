import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import {
  RepositorySummaryCard,
  InvestigationPanel,
  SearchActivityRow,
  type SearchActivity,
} from './repository-search-display';

const completed: SearchActivity = {
  tool: 'search_code',
  phase: 'completed',
  summary: 'Searching for SessionManager',
  matchCount: 6,
  durationMs: 38,
  truncated: true,
  skippedFiles: 1,
  errorCode: null,
  citations: [
    {
      id: 'search-1',
      path: 'auth/session.py',
      matchLine: 52,
      startLine: 52,
      endLine: 52,
      label: 'auth/session.py:52',
      text: 'async def resolve(self, token: string):',
      before: [],
      after: [],
    },
  ],
};

describe('RepositorySummaryCard', () => {
  it('renders detected values and a partial scan indicator', () => {
    render(
      <RepositorySummaryCard
        summary={{
          language: 'Python',
          languageConfidence: 'high',
          fileCount: 342,
          approximateLines: 28_000,
          testFramework: 'pytest',
          testCommand: 'uv run pytest',
          truncated: true,
        }}
      />,
    );

    expect(screen.getByText('Python')).toBeInTheDocument();
    expect(screen.getByText(/342 files · 28K LOC/i)).toBeInTheDocument();
    expect(screen.getByText('pytest')).toHaveAttribute('title', 'uv run pytest');
    expect(screen.getByText('SCAN PARTIAL')).toBeInTheDocument();
  });
});

describe('SearchActivityRow', () => {
  it('renders bounded result metadata and routes a citation selection', () => {
    const onSelect = vi.fn();
    render(<SearchActivityRow activity={completed} onSelectCitation={onSelect} />);

    expect(screen.getByText('6 hits')).toBeInTheDocument();
    expect(screen.getByText('TRUNCATED')).toBeInTheDocument();
    expect(screen.getByText('1 file skipped')).toBeInTheDocument();
    const citation = screen.getByRole('link', { name: 'auth/session.py:52' });
    fireEvent.click(citation);
    expect(onSelect).toHaveBeenCalledWith(completed.citations[0]);
  });

  it.each([
    ['loading', null, null, 'Searching...'],
    ['completed', 0, null, 'No matches'],
    ['error', null, 'search_timed_out', 'Timed out'],
    ['error', null, 'search_failed', 'Search failed'],
  ] as const)(
    'renders %s state without inventing results',
    (phase, matchCount, errorCode, label) => {
      render(
        <SearchActivityRow
          activity={{ ...completed, phase, matchCount, errorCode, citations: [] }}
          onSelectCitation={() => undefined}
        />,
      );

      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );
});

describe('InvestigationPanel', () => {
  it('selects supporting evidence in the work panel', () => {
    const onSelectEvidence = vi.fn();
    const evidence = {
      citation_id: 'search-investigation-1-1',
      path: 'auth/session.py',
      start_line: 51,
      end_line: 53,
      label: 'auth/session.py:51-53',
      excerpt: 'def expire(token):',
    };
    render(
      <InvestigationPanel
        result={{
          status: 'complete',
          question: 'Why?',
          summary: 'Evidence found.',
          hypotheses: [
            {
              rank: 1,
              title: 'Expiry path',
              explanation: 'The retrieved code is a lead.',
              confidence: 'high',
              evidence: [evidence],
              verification_suggestions: ['Add a regression test.'],
            },
          ],
          tool_calls: 1,
          returned_bytes: 100,
          stop_reason: null,
        }}
        onSelectEvidence={onSelectEvidence}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: /auth\/session.py:51-53/ }));
    expect(onSelectEvidence).toHaveBeenCalledWith(evidence);
  });
});
