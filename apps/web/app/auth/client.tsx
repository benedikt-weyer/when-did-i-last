'use client';

import { Button } from '@/components/ui/button';

import {
  PageShell,
  SignedOutForm,
  StatusPanel,
  panelClassName,
  useSessionPageState,
} from '../shared/session-page';

export function AuthPageClient() {
  const sessionState = useSessionPageState();

  return (
    <PageShell title="Authentication">
      <div className={panelClassName} id="auth">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              {sessionState.session ? 'Encrypted session' : 'Authenticate'}
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-foreground">
              {sessionState.session ? `Signed in as ${sessionState.session.user.email}` : 'Login or register'}
            </h2>
          </div>
          {sessionState.session ? (
            <Button onClick={() => sessionState.handleSignOut()} variant="outline">
              Sign out
            </Button>
          ) : null}
        </div>

        {sessionState.session ? (
          <div className="grid gap-4">
            <div className="rounded-[1.4rem] border border-border/60 bg-background/80 p-4 text-sm leading-6 text-foreground/75">
              Session is active. Use the navbar to open cards or account settings.
            </div>
            <StatusPanel statusMessage={sessionState.statusMessage} />
          </div>
        ) : (
          <SignedOutForm
            email={sessionState.email}
            errorMessage={sessionState.errorMessage}
            isHydrated={sessionState.isHydrated}
            isSubmitting={sessionState.isSubmitting}
            mode={sessionState.mode}
            olderPasswords={sessionState.olderPasswords}
            onSubmit={sessionState.handleSubmit}
            password={sessionState.password}
            requiredOlderKeks={sessionState.requiredOlderKeks}
            setEmail={sessionState.setEmail}
            setMode={sessionState.setMode}
            setOlderPasswords={sessionState.setOlderPasswords}
            setPassword={sessionState.setPassword}
          />
        )}
      </div>
    </PageShell>
  );
}