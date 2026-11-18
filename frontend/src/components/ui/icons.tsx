export function Icon({
  name,
  className = '',
}: {
  name:
    | 'chevron'
    | 'repo'
    | 'branch'
    | 'commit'
    | 'pull-request'
    | 'external'
    | 'code'
    | 'copy'
    | 'folder'
    | 'file'
    | 'activity'
    | 'sync'
    | 'shield'
    | 'arrow'
    | 'send'
    | 'plus'
    | 'more'
    | 'edit'
    | 'close'
    | 'check'
    | 'error'
    | 'user'
    | 'settings'
    | 'personalization';
  className?: string;
}) {
  const paths = {
    copy: 'M9 9h12v12H9zM15 9V3H3v12h6',
    code: 'm8 6-6 6 6 6m8-12 6 6-6 6m-2-15-4 18',
    folder: 'M3 6h7l2 3h9v10H3z',
    file: 'M6 3h8l4 4v14H6zm8 0v5h4',
    chevron: 'm9 5 7 7-7 7',
    user: 'M8 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
    personalization: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
    settings:
      'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9.7 3.3l-.5 2-1.8 1-2-.6-2.3 4 1.5 1.4v2l-1.5 1.4 2.3 4 2-.6 1.8 1 .5 2h4.6l.5-2 1.8-1 2 .6 2.3-4-1.5-1.4v-2l1.5-1.4-2.3-4-2 .6-1.8-1-.5-2Z',
    repo: 'M4 3h13v16H4a2 2 0 0 1 0-4h13M4 3a2 2 0 0 0-2 2v12M7 7h6M7 10h4',
    branch:
      'M6 8v8m0 0c0-5 12-2 12-8M4 6a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm0 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM16 6a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z',
    'pull-request':
      'M6 8v8m-2-10a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm0 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm12 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM18 16v-5a5 5 0 0 0-5-5h-2m3-3-3 3 3 3',
    external: 'M14 4h6v6m0-6-9 9m7 0v7H4V6h7',
    commit: 'M3 12h5m8 0h5m-13 0a4 4 0 1 0 8 0 4 4 0 0 0-8 0Z',
    sync: 'M20 10a8 8 0 0 0-14-4L3 9m0-5v5h5m-4 5a8 8 0 0 0 14 4l3-3m0 5v-5h-5',
    activity: 'M3 12h4l3-7 4 14 3-7h4',
    shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    send: 'M12 19V5m-6 6 6-6 6 6',
    edit: 'm16 3 5 5-12 12-6 1 1-6L16 3Zm-3 3 5 5',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    plus: 'M12 5v14M5 12h14',
    close: 'm6 6 12 12M6 18 18 6',
    check: 'm5 12 4 4L19 6',
    error: 'M12 8v5m0 3h.01M12 3 2 20h20L12 3Z',
  };
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
