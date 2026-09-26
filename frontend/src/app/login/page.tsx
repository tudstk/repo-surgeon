import { Suspense } from 'react';

import { LoginScreen } from '../auth-shell';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginScreen />
    </Suspense>
  );
}
