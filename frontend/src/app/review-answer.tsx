'use client';

import { Children, isValidElement, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import { Icon } from '@/components/ui/icons';
import { highlightedCode } from '@/lib/code-highlight';
import styles from './review-answer.module.css';

function CodeBlock({ children }: { children?: ReactNode }) {
  const child = Children.toArray(children)[0];
  const props = isValidElement<{ children?: ReactNode; className?: string }>(child)
    ? child.props
    : undefined;
  const text = String(props?.children ?? '').replace(/\n$/, '');
  const language = props?.className?.match(/language-([\w+-]+)/)?.[1] ?? 'text';
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span>{language}</span>
        <button
          type="button"
          onClick={async () => {
            setFailed(false);
            try {
              await navigator.clipboard.writeText(text);
              setCopiedText(text);
            } catch {
              setFailed(true);
            }
          }}
        >
          <Icon name={copiedText === text ? 'check' : 'copy'} />
          {copiedText === text ? 'Copied' : 'Copy code'}
        </button>
      </div>
      {failed ? (
        <p className={styles.copyError} role="alert">
          Copy failed. Select the code to copy it manually.
        </p>
      ) : null}
      <pre tabIndex={0} aria-label="Suggested code" className="diff-syntax">
        <code>{text.length <= 20_000 ? highlightedCode(`snippet.${language}`, text) : text}</code>
      </pre>
    </div>
  );
}

// Emphasize prose quantities without rewriting links or syntax-highlighted code.
function emphasizeNumbers(children: ReactNode) {
  return Children.map(children, (child) =>
    typeof child === 'string'
      ? child.split(/(\b\d+(?:[.,]\d+)*%?)/g).map((part, index) =>
          index % 2 ? (
            <span className={styles.number} key={index}>
              {part}
            </span>
          ) : (
            part
          ),
        )
      : child,
  );
}

export function ReviewAnswer({ text }: { text: string }) {
  return (
    <div className={styles.answer}>
      <Markdown
        skipHtml
        components={{
          pre: CodeBlock,
          p: ({ children }) => <p>{emphasizeNumbers(children)}</p>,
          li: ({ children }) => <li>{emphasizeNumbers(children)}</li>,
          img: () => null,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
