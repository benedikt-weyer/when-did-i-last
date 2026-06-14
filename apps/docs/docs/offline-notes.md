# Offline Notes

This page describes the offline note model used by the web and mobile apps,
how local SQLite becomes the frontend source of truth, and how local changes
are synchronized back to the backend when connectivity returns.

## What exists now

The monorepo now includes a shared offline state package:

- `@repo/offline-provider`

That package is used by both frontend targets:

- the web app uses SQLite WASM through `sql.js`
- the mobile app uses `expo-sqlite`

In both cases the local SQLite database is the authoritative source of note UI
state after the client initializes. The UI reads from the local database first,
not directly from `GET /api/notes`.

The backend remains the encrypted system of record for synchronized notes, but
the frontend no longer depends on a live network round-trip to render the
current note list or to accept edits.

## Local database layout

The local store uses two tables:

### `notes`

This table stores the decrypted note document that the UI works with:

- `id`
- `title`
- `content`
- `createdAt`
- `updatedAt`
- `isLocalOnly`

The plaintext here is intentional. The requirement for this feature is that the
decrypted note data remains available across app restarts and while fully
offline.

### `offline_changes`

This table tracks pending mutations that still need to be replayed to the
backend:

- `noteId`
- `type` where the value is either `upsert` or `delete`
- `changedAt`

Only one current pending change per note is needed. The provider collapses the
pending state to the latest relevant mutation for each note.

## Why the UI reads local first

Before this feature, the note screens were shaped around the backend as the
immediate load path:

1. fetch encrypted notes from the backend
2. decrypt them locally
3. render the result in memory

With offline support, that order becomes:

1. open the local SQLite database
2. hydrate the note list from local rows
3. render immediately from the local snapshot
4. run a background sync when a session and backend connectivity are available

This shift is what makes restart-safe offline access possible.

```plantuml format="svg_inline" alt="Offline note initialization flow" title="Offline note initialization flow"
@startuml
skinparam shadowing false

actor User
participant "Web / Mobile App" as Client
participant "@repo/offline-provider" as Offline
database "Local SQLite\nnotes + offline_changes" as LocalDb
participant "Notes API" as Api

User -> Client: Open app
Client -> Offline: initialize()
Offline -> LocalDb: open schema + read notes
LocalDb --> Offline: local snapshot
Offline --> Client: notes for UI render
Client --> User: visible note list, even offline

alt session + network available
  Client -> Offline: sync(adapter)
  Offline -> Api: fetch / replay pending changes
  Api --> Offline: encrypted backend state
  Offline -> LocalDb: reconcile local snapshot
  Offline --> Client: refreshed local snapshot
end
@enduml
```

## Save and delete behavior

When a user edits a note while online or offline, the first write is always to
the local SQLite database.

### Save flow

1. The app writes the plaintext note into `notes`.
2. The app updates `updatedAt` locally.
3. The app records an `upsert` entry in `offline_changes`.
4. If backend sync is possible, the provider encrypts and uploads the note.
5. After a successful sync, the pending change is removed.

### Delete flow

1. The app removes the note from `notes` immediately.
2. If the note only existed locally, the pending state is dropped completely.
3. If the note had already been synchronized before, the app records a `delete`
   entry in `offline_changes`.
4. The provider later sends the delete to the backend.
5. After a successful sync, the pending delete is removed.

This gives the UI immediate local responsiveness without waiting for the
backend.

## Sync rules

The sync algorithm is intentionally small and deterministic.

### 1. Pending deletes are pushed first

Deletes are processed before any upserts. That prevents a stale local update
from re-creating a note that the user already removed locally.

### 2. Remote absence deletes local synchronized rows

If a note exists locally, is not marked as local-only, and no pending local
change exists, then a missing remote note means the local copy should also be
removed.

This is how server-side deletions and note removals from another device are
propagated back into the local SQLite store.

### 3. Local-only notes are created remotely with stable ids

Offline-created notes are assigned ids locally first. When connectivity
returns, the provider sends those ids through the backend `PUT /api/notes/{id}`
upsert path so the note identity does not need to be remapped after sync.

### 4. Non-delete conflicts use latest-write-wins

If the same note changed both locally and remotely, the provider compares the
timestamps:

- newer local `updatedAt` means push the local note to the backend
- newer remote `updatedAt` means replace the local note with the remote one

That is a plain latest-write-wins rule for updates.

### 5. Deletes always win

Deletes are not modeled with tombstones. The required behavior here is simpler:

- if one side deleted the note and the other side updated it, the note is
  deleted everywhere

So the special conflict policy is:

- update vs update: latest `updatedAt` wins
- delete vs anything: delete wins

```plantuml format="svg_inline" alt="Offline note sync conflict rules" title="Offline note sync conflict rules"
@startuml
skinparam shadowing false

rectangle "Pending local delete" as LocalDelete
rectangle "Pending local upsert" as LocalUpsert
rectangle "Remote note state" as RemoteState
rectangle "Resolved result" as Result

LocalDelete --> Result : delete wins
LocalUpsert --> Result : compare updatedAt
RemoteState --> Result : compare updatedAt

note bottom of Result
delete vs update -> delete everywhere
update vs update -> latest updatedAt wins
end note
@enduml
```

## Encryption boundary

The local SQLite database stores decrypted note content for offline access, but
the backend contract stays encrypted.

That means every successful remote upsert still uses the existing E2EE flow:

1. serialize the local note document
2. encrypt it locally on-device
3. wrap the DEK for the current recipients
4. send only ciphertext and wrapped DEKs to the backend

When remote notes are fetched during sync, the provider adapter decrypts them
locally before storing the plaintext document in SQLite.

So the security boundary is now:

- backend storage: encrypted
- frontend local offline cache: decrypted

That tradeoff is deliberate because offline readable UI state is a hard feature
requirement.

## Platform-specific implementation

The shared sync logic is platform-independent, but the storage engines differ.

### Web

The web adapter lives behind `createWebOfflineNotesProvider()` and uses:

- `sql.js`
- SQLite WASM loaded from `/vendor/sql-wasm.wasm`
- serialized database persistence through browser storage

### Mobile

The mobile adapter lives behind `createNativeOfflineNotesProvider()` and uses:

- `expo-sqlite`
- a native on-device SQLite database file

The schema and sync behavior are the same on both targets.

## Trigger points for sync

The apps trigger synchronization in a few places:

- after provider initialization when a valid session exists
- after local save or delete operations
- after note import operations
- after realtime note invalidation events
- after connectivity or foreground return events

Realtime updates still act as invalidation signals, not as direct payload sync.
The offline provider receives that signal and then reconciles local SQLite with
the backend through the normal note routes.

See [Realtime Updates](realtime-updates.md) for the websocket invalidation
model that now feeds into the offline sync step.

## Integration coverage

The full backend integration suite now includes an offline sync test flow that
exercises the provider against the real Rust backend note APIs.

That test covers:

- offline local note creation followed by later remote sync
- update conflicts where the newer `updatedAt` wins
- delete-wins behavior against competing remote updates
- propagation of remote deletions back into the local snapshot

This is implemented in the backend integration test package so the sync logic is
validated against the real API contract instead of only mocked transport.

## Practical implications

- The note UI remains usable without connectivity.
- The frontend can restart and still recover decrypted note state locally.
- Sync stays deterministic because it only needs `notes`, `offline_changes`, and
  a small set of conflict rules.
- The backend note APIs remain the same encrypted contract; the offline feature
  is a client-side coordination layer on top of them.