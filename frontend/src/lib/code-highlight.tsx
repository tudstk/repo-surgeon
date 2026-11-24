import { common, createLowlight } from 'lowlight';
import { Children, cloneElement, isValidElement, type ReactNode } from 'react';

const highlighter = createLowlight(common);
const languageAliases: Record<string, string> = {
  tsx: 'typescript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  svg: 'xml',
  cs: 'csharp',
  yml: 'yaml',
  dockerfile: 'dockerfile',
};

export function highlightedCode(path: string, text: string): ReactNode {
  const name = path.split('/').at(-1)?.toLowerCase() ?? '';
  const extension = name.split('.').at(-1) ?? '';
  const language = Object.hasOwn(languageAliases, extension)
    ? languageAliases[extension]
    : extension;
  if (!highlighter.registered(language)) return text;
  // Lowlight returns text and styled spans. Render only those as React nodes.
  const tree = highlighter.highlight(language, text);
  type Token = (typeof tree.children)[number];
  function render(token: Token, index: number): ReactNode {
    if (token.type === 'text') return token.value;
    if (token.type !== 'element') return null;
    const classes = token.properties.className;
    return (
      <span key={index} className={Array.isArray(classes) ? classes.join(' ') : undefined}>
        {token.children.map(render)}
      </span>
    );
  }
  return tree.children.map(render);
}

/** Split already highlighted tokens while preserving multiline syntax state. */
export function highlightedCodeLines(path: string, text: string): ReactNode[][] {
  function split(children: ReactNode): ReactNode[][] {
    const lines: ReactNode[][] = [[]];
    for (const child of Children.toArray(children)) {
      let parts: ReactNode[][];
      if (typeof child === 'string') {
        parts = child.split('\n').map((line) => [line]);
      } else if (isValidElement<{ children?: ReactNode }>(child)) {
        parts = split(child.props.children).map((line, index) => [
          cloneElement(child, { key: `${child.key}-${index}` }, line),
        ]);
      } else {
        parts = [[child]];
      }
      lines[lines.length - 1].push(...parts[0]);
      lines.push(...parts.slice(1));
    }
    return lines;
  }
  return split(highlightedCode(path, text));
}
