export function Icon({
  name,
  className = '',
}: {
  name:
    | 'repo'
    | 'activity'
    | 'shield'
    | 'arrow'
    | 'plus'
    | 'close'
    | 'check'
    | 'error'
    | 'user'
    | 'settings';
  className?: string;
}) {
  const paths = {
    user: 'M8 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
    settings:
      'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9.7 3.3l-.5 2-1.8 1-2-.6-2.3 4 1.5 1.4v2l-1.5 1.4 2.3 4 2-.6 1.8 1 .5 2h4.6l.5-2 1.8-1 2 .6 2.3-4-1.5-1.4v-2l1.5-1.4-2.3-4-2 .6-1.8-1-.5-2Z',
    repo: 'M4 3h13v16H4a2 2 0 0 1 0-4h13M4 3a2 2 0 0 0-2 2v12M7 7h6M7 10h4',
    activity: 'M3 12h4l3-7 4 14 3-7h4',
    shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
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
