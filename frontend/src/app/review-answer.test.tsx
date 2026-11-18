import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ReviewAnswer } from './review-answer';

it('renders safe Markdown and copies only code, including after a streamed update', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const { rerender, container } = render(
    <ReviewAnswer
      text={
        '## Findings\n\n```javascript\nconst n = 1;\n```\n\n<img src="https://example.invalid/tracker" />\n\n[unsafe](javascript:alert(1))'
      }
    />,
  );
  expect(screen.getByRole('heading', { name: 'Findings' })).toBeInTheDocument();
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getByText('unsafe')).not.toHaveAttribute(
    'href',
    expect.stringMatching(/javascript:/),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
  await screen.findByRole('button', { name: 'Copied' });
  expect(writeText).toHaveBeenCalledWith('const n = 1;');
  rerender(<ReviewAnswer text={'```javascript\nconst n = 2;\n```'} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
  await screen.findByRole('button', { name: 'Copied' });
  expect(writeText).toHaveBeenLastCalledWith('const n = 2;');
});

it('explains an unavailable clipboard', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  render(<ReviewAnswer text={'```python\nprint(1)\n```'} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Select the code');
});
