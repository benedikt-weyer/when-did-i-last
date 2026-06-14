'use client';

import {
	startTransition,
	useCallback,
	useEffect,
	useState,
	type Dispatch,
	type ReactNode,
	type SetStateAction,
} from 'react';
import { ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
	fetchPasswordSalt,
	loginRequest,
	refreshSessionRequest,
	registerRequest,
	type AuthApiResponse,
	type KekMetadata,
} from '@/lib/auth-api';
import {
	AUTH_STORAGE_SYNC_EVENT,
	localStorageAuthPersistence,
	readAuthPreferences,
	writeAuthPreferences,
	type PersistedLinkedKek,
} from '@/lib/auth-storage';

import {
	createPasswordSalt,
	deriveCredentials,
	deriveKekKeyPair,
	normalizeEmail,
} from '@repo/e2ee-auth/web';

import {
	hasUnauthorizedStatus,
	mergeLinkedKeks,
	sortKekMetadatas,
	type AuthMode,
} from './session-page-helpers';

export type AuthenticatedContext = {
	linkedKeks: PersistedLinkedKek[];
	mode: AuthMode;
	session: AuthApiResponse;
	trimmedBackendUrl: string;
};

export type RunWithSessionRetry = <T,>(
	currentSession: AuthApiResponse,
	trimmedBackendUrl: string,
	callback: (activeSession: AuthApiResponse) => Promise<T>,
) => Promise<T>;

type UseSessionPageStateOptions = {
	onAuthenticated?: (context: AuthenticatedContext) => Promise<string | void> | string | void;
};

export const panelClassName = 'grid gap-4 rounded-[1.75rem] border border-border/70 bg-card/80 p-5 shadow-sm backdrop-blur';
export const sectionClassName = 'grid gap-3 rounded-[1.4rem] border border-border/60 bg-background/80 p-4';

export function useSessionPageState(
	options: UseSessionPageStateOptions = {},
) {
	const { onAuthenticated } = options;
	const [mode, setMode] = useState<AuthMode>('register');
	const [backendUrl, setBackendUrl] = useState('');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [session, setSession] = useState<AuthApiResponse | null>(null);
	const [linkedKeks, setLinkedKeks] = useState<PersistedLinkedKek[]>([]);
	const [olderPasswords, setOlderPasswords] = useState<Record<string, string>>({});
	const [requiredOlderKeks, setRequiredOlderKeks] = useState<KekMetadata[]>([]);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [statusMessage, setStatusMessage] = useState('');
	const [isHydrated, setIsHydrated] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const persistAuthSession = useCallback((nextSession: AuthApiResponse) => {
		setSession(nextSession);
		localStorageAuthPersistence.writeAuthSession(nextSession);
	}, []);

	const clearSessionState = useCallback((options?: {
		clearDerivedCredentials?: boolean;
		statusMessage?: string;
	}) => {
		setSession(null);
		setPassword('');
		setOlderPasswords({});
		setRequiredOlderKeks([]);
		localStorageAuthPersistence.clearAuthSession();

		if (options?.clearDerivedCredentials) {
			setLinkedKeks([]);
			localStorageAuthPersistence.clearDerivedCredentials();
		}

		if (options?.statusMessage !== undefined) {
			setStatusMessage(options.statusMessage);
		}
	}, []);

	const refreshSession = useCallback(async (
		currentSession: AuthApiResponse,
		trimmedBackendUrl: string,
	) => {
		const nextSession = await refreshSessionRequest({
			baseUrl: trimmedBackendUrl,
			refreshToken: currentSession.refreshToken,
		});

		persistAuthSession(nextSession);
		return nextSession;
	}, [persistAuthSession]);

	const runWithSessionRetry = useCallback<RunWithSessionRetry>(async (
		currentSession,
		trimmedBackendUrl,
		callback,
	) => {
		try {
			return await callback(currentSession);
		} catch (error) {
			if (!hasUnauthorizedStatus(error)) {
				throw error;
			}

			try {
				const refreshedSession = await refreshSession(currentSession, trimmedBackendUrl);
				return await callback(refreshedSession);
			} catch (refreshError) {
				if (hasUnauthorizedStatus(refreshError)) {
					clearSessionState({
						statusMessage: 'Session expired. Log in again.',
					});
					throw new Error('Session expired. Log in again.');
				}

				throw refreshError;
			}
		}
	}, [clearSessionState, refreshSession]);

	useEffect(() => {
		queueMicrotask(() => {
			const preferences = readAuthPreferences();
			const storedSession = localStorageAuthPersistence.readAuthSession();
			const storedCredentials = localStorageAuthPersistence.readDerivedCredentials();

			setBackendUrl(preferences.backendUrl);
			setLinkedKeks(storedCredentials?.linkedKeks ?? []);
			setSession(storedSession);
			setEmail(storedCredentials?.email ?? preferences.lastEmail);
			setIsHydrated(true);
		});
	}, []);

	useEffect(() => {
		const nextMode = new URLSearchParams(globalThis.window.location.search).get('mode');

		if (nextMode === 'login' || nextMode === 'register') {
			startTransition(() => {
				setMode(nextMode);
			});
		}
	}, []);

	useEffect(() => {
		const syncFromStorage = () => {
			const preferences = readAuthPreferences();
			const storedSession = localStorageAuthPersistence.readAuthSession();
			const storedCredentials = localStorageAuthPersistence.readDerivedCredentials();

			setBackendUrl(preferences.backendUrl);
			setSession(storedSession);
			setLinkedKeks(storedCredentials?.linkedKeks ?? []);
			setEmail(storedCredentials?.email ?? preferences.lastEmail);
		};

		globalThis.window.addEventListener(AUTH_STORAGE_SYNC_EVENT, syncFromStorage);
		globalThis.window.addEventListener('storage', syncFromStorage);

		return () => {
			globalThis.window.removeEventListener(AUTH_STORAGE_SYNC_EVENT, syncFromStorage);
			globalThis.window.removeEventListener('storage', syncFromStorage);
		};
	}, []);

	const handleSubmit = useCallback(async () => {
		setErrorMessage(null);
		setIsSubmitting(true);

		try {
			const trimmedBackendUrl = backendUrl.trim();
			const normalizedEmail = normalizeEmail(email);
			const storedCredentials = localStorageAuthPersistence.readDerivedCredentials();
			const persistedLinkedKeks =
				storedCredentials?.email === normalizedEmail ? storedCredentials.linkedKeks : [];
			const saltMaterial =
				mode === 'login'
					? await fetchPasswordSalt({
							baseUrl: trimmedBackendUrl,
							email: normalizedEmail,
						})
					: {
							kekMetadatas: [] as KekMetadata[],
							saltHex: await createPasswordSalt(),
						};
			const saltHex = saltMaterial.saltHex;
			const sortedKekMetadatas = sortKekMetadatas(saltMaterial.kekMetadatas);
			const missingOlderKeks =
				mode === 'login'
					? sortedKekMetadatas.slice(1).filter(
							(metadata) =>
								!persistedLinkedKeks.some(
									(linkedKek) => linkedKek.kekPublicKey === metadata.kekPublicKey,
								) &&
								!olderPasswords[metadata.kekPublicKey]?.trim(),
						)
					: [];

			setRequiredOlderKeks(sortedKekMetadatas.slice(1));

			if (missingOlderKeks.length > 0) {
				throw new Error('Enter the passwords for the older active KEKs before logging in.');
			}

			const credentials = await deriveCredentials(normalizedEmail, password, saltHex);
			const registerKekKeyPair =
				mode === 'register' ? await deriveKekKeyPair(credentials.cryptKey) : null;
			const response =
				mode === 'login'
					? await loginRequest({
							authKey: credentials.authKey,
							baseUrl: trimmedBackendUrl,
							email: credentials.email,
						})
					: await registerRequest({
							authKey: credentials.authKey,
							baseUrl: trimmedBackendUrl,
							email: credentials.email,
							kekPublicKey: registerKekKeyPair!.kekPublicKey,
							saltHex,
						});
			const responseKekMetadatas = sortKekMetadatas(response.kekMetadatas);
			const latestKekMetadata = responseKekMetadatas[0];

			if (!latestKekMetadata) {
				throw new Error('The backend did not return KEK metadata.');
			}

			const retainedLinkedKeks = persistedLinkedKeks.filter((linkedKek) =>
				responseKekMetadatas.some((metadata) => metadata.kekPublicKey === linkedKek.kekPublicKey),
			);
			const nextDerivedLinkedKeks: PersistedLinkedKek[] = [
				{
					cryptKey: credentials.cryptKey,
					kekEpochVersion: latestKekMetadata.kekEpochVersion,
					kekPublicKey: latestKekMetadata.kekPublicKey,
					saltHex,
				},
			];

			for (const metadata of responseKekMetadatas.slice(1)) {
				if (retainedLinkedKeks.some((linkedKek) => linkedKek.kekPublicKey === metadata.kekPublicKey)) {
					continue;
				}

				const olderPassword = olderPasswords[metadata.kekPublicKey]?.trim();

				if (!olderPassword) {
					continue;
				}

				const olderCredentials = await deriveCredentials(normalizedEmail, olderPassword, saltHex);

				nextDerivedLinkedKeks.push({
					cryptKey: olderCredentials.cryptKey,
					kekEpochVersion: metadata.kekEpochVersion,
					kekPublicKey: metadata.kekPublicKey,
					saltHex,
				});
			}

			const nextLinkedKeks = mergeLinkedKeks([
				...retainedLinkedKeks,
				...nextDerivedLinkedKeks,
			]);

			persistAuthSession(response);
			setLinkedKeks(nextLinkedKeks);
			setEmail(credentials.email);
			setPassword('');
			setOlderPasswords({});
			setRequiredOlderKeks([]);

			writeAuthPreferences({
				backendUrl: trimmedBackendUrl,
				lastEmail: credentials.email,
			});
			localStorageAuthPersistence.writeDerivedCredentials({
				email: credentials.email,
				linkedKeks: nextLinkedKeks,
			});

			const nextStatusMessage = await onAuthenticated?.({
				linkedKeks: nextLinkedKeks,
				mode,
				session: response,
				trimmedBackendUrl,
			});

			setStatusMessage(
				nextStatusMessage ?? (mode === 'register' ? 'Account created.' : 'Logged in.'),
			);
		} catch (error) {
			setErrorMessage(
				error instanceof Error ? error.message : 'Authentication failed unexpectedly.',
			);
		} finally {
			setIsSubmitting(false);
		}
	}, [backendUrl, email, mode, olderPasswords, onAuthenticated, password, persistAuthSession]);

	const handleSignOut = useCallback((nextStatusMessage = 'Signed out.') => {
		clearSessionState({
			statusMessage: nextStatusMessage,
		});
	}, [clearSessionState]);

	return {
		backendUrl,
		clearSessionState,
		email,
		errorMessage,
		handleSignOut,
		handleSubmit,
		isHydrated,
		isSubmitting,
		linkedKeks,
		mode,
		olderPasswords,
		persistAuthSession,
		refreshSession,
		requiredOlderKeks,
		runWithSessionRetry,
		session,
		setBackendUrl,
		setEmail,
		setErrorMessage,
		setLinkedKeks,
		setMode,
		setOlderPasswords,
		setPassword,
		setRequiredOlderKeks,
		setSession,
		setStatusMessage,
		statusMessage,
		password,
	};
}

export type SessionPageState = ReturnType<typeof useSessionPageState>;

type SignedOutFormProps = {
	email: string;
	errorMessage: string | null;
	isHydrated: boolean;
	isSubmitting: boolean;
	mode: AuthMode;
	olderPasswords: Record<string, string>;
	onSubmit: () => void;
	password: string;
	requiredOlderKeks: KekMetadata[];
	setEmail: (value: string) => void;
	setMode: (value: AuthMode) => void;
	setOlderPasswords: Dispatch<SetStateAction<Record<string, string>>>;
	setPassword: (value: string) => void;
};

export function SignedOutForm({
	email,
	errorMessage,
	isHydrated,
	isSubmitting,
	mode,
	olderPasswords,
	onSubmit,
	password,
	requiredOlderKeks,
	setEmail,
	setMode,
	setOlderPasswords,
	setPassword,
}: Readonly<SignedOutFormProps>) {
	return (
		<>
			<div className="grid grid-cols-2 gap-2 rounded-full border border-border/70 bg-muted/60 p-1">
				{(['register', 'login'] as const).map((nextMode) => {
					const isActive = nextMode === mode;

					return (
						<button
							className={`rounded-full px-4 py-3 text-sm font-semibold uppercase tracking-[0.18em] transition ${
								isActive
									? 'bg-primary text-primary-foreground shadow-sm'
									: 'text-foreground/70 hover:bg-background/80'
							}`}
							key={nextMode}
							onClick={() => setMode(nextMode)}
							type="button"
						>
							{nextMode}
						</button>
					);
				})}
			</div>

			<div className="grid gap-4">
				<LabeledInput
					autoComplete="email"
					label="Email"
					onChange={setEmail}
					placeholder="hello@example.com"
					type="email"
					value={email}
				/>
				<LabeledInput
					autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
					label="Password"
					onChange={setPassword}
					placeholder="Type the password used to derive keys"
					type="password"
					value={password}
				/>
				{mode === 'login' && requiredOlderKeks.length > 0
					? requiredOlderKeks.map((metadata) => (
							<LabeledInput
								autoComplete="current-password"
								key={metadata.kekPublicKey}
								label={`Older password v${metadata.kekEpochVersion}`}
								onChange={(value) =>
									setOlderPasswords((currentPasswords) => ({
										...currentPasswords,
										[metadata.kekPublicKey]: value,
									}))
								}
								placeholder="Type the older password for this active KEK"
								type="password"
								value={olderPasswords[metadata.kekPublicKey] ?? ''}
							/>
						))
					: null}
			</div>

			{mode === 'login' && requiredOlderKeks.length > 0 ? (
				<p className="rounded-[1.2rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
					Older KEKs still need passwords before older cards can be unlocked on this device.
				</p>
			) : null}

			{errorMessage ? (
				<p className="rounded-[1.2rem] bg-rose-100 px-4 py-3 text-sm font-medium text-rose-700">
					{errorMessage}
				</p>
			) : null}

			<Button
				disabled={!isHydrated || isSubmitting}
				onClick={onSubmit}
				size="lg"
			>
				{mode === 'register' ? 'Create account' : 'Log in'}
				<ArrowRight />
			</Button>
		</>
	);
}

type StatusPanelProps = {
	selectedNoteId?: string | null;
	statusMessage: string;
};

export function StatusPanel({
	selectedNoteId,
	statusMessage,
}: Readonly<StatusPanelProps>) {
	return (
		<div className="grid gap-2 rounded-[1.4rem] border border-border/70 bg-muted/45 p-4 text-sm leading-6 text-foreground/75">
			<p>{statusMessage || 'No recent activity.'}</p>
			{selectedNoteId ? (
				<p>
					Selected card id: <span className="font-mono text-xs">{selectedNoteId}</span>
				</p>
			) : null}
		</div>
	);
}

type PageShellProps = {
	children: ReactNode;
	title: string;
};

export function PageShell({
	children,
	title,
}: Readonly<PageShellProps>) {
	return (
		<main className="relative overflow-hidden">
			<div className="absolute inset-0 -z-10 bg-grid-paper bg-[size:40px_40px] opacity-20" />
			<div className="absolute left-[8%] top-16 -z-10 size-72 rounded-full bg-secondary/40 blur-3xl" />
			<div className="absolute bottom-0 right-[10%] -z-10 size-80 rounded-full bg-primary/10 blur-3xl" />

			<section className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl flex-col gap-6 px-6 py-8 sm:px-10 lg:px-12">
				<div className="flex flex-col gap-2 border-b border-border/60 pb-4">
					<p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
						When Did I Last
					</p>
					<h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
						{title}
					</h1>
				</div>

				{children}
			</section>
		</main>
	);
}

type LabeledInputProps = {
	autoComplete: string;
	label: string;
	onChange: (value: string) => void;
	placeholder: string;
	type: 'email' | 'password' | 'text';
	value: string;
};

export function LabeledInput({
	autoComplete,
	label,
	onChange,
	placeholder,
	type,
	value,
}: Readonly<LabeledInputProps>) {
	return (
		<label className="grid gap-2">
			<span className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
				{label}
			</span>
			<input
				autoComplete={autoComplete}
				className="rounded-[1.4rem] border border-border bg-background/80 px-4 py-4 text-base text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				type={type}
				value={value}
			/>
		</label>
	);
}