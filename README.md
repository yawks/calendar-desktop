# Courrier

A calendar and email application sharing a React interface and a Rust core across native Android (Capacitor + JNI), cross-platform native desktop (Tauri 2), and Web/PWA (Axum).

Account credentials are not persisted on the server. They are stored in an IndexedDB vault encrypted with the user's master password.

Calendar groups, their organization, tags, and event–tag associations are stored in the encrypted local vault. They are included when uploading and restoring WebDAV/Nextcloud configuration, making them available on other devices. Existing local data is migrated automatically; after making changes, upload the configuration to update the remote copy.


## Event availability and privacy

The create and edit form offers the provider's values: free, busy, tentative, out of office, and working elsewhere for Exchange/EWS, along with normal, personal, private, or confidential sensitivity. Google Calendar offers availability and visibility, plus out of office, focus time, working location, and birthday event types when creating events on the primary calendar, depending on permissions and the Google subscription. The Google event type cannot change after creation; out of office and focus time require specific times and do not automatically decline invitations. Birthdays are all-day events that repeat annually. CalDAV/Nextcloud uses the standard public, private, confidential, and free/busy values, with no standard “out of office” status. Markers (🔒, 🏖, 🎯, 🏠, 🎂, ○, ?) identify these properties in the calendar, search, and details. Privacy is enforced by the server according to sharing permissions; the marker provides no additional protection. ICS subscriptions display received properties as read-only. IMAP/SMTP and JMAP do not provide calendars in Courrier.

On **Android**, **Preferences → Android calendars** lets you select Google Calendar, Exchange/EWS, CalDAV/Nextcloud, and ICS calendars to view in apps that use Android's calendar storage. These copies retain the name and color and are read-only: changes are never sent back to the server. They follow synchronization while Courrier is open and unlocked, as well as when it returns to the foreground, and remain available after it closes. Only periods loaded by Courrier are published, with recurring events represented as individual occurrences and no additional reminders. If a source cannot be read, its last copy is retained. Deselecting a calendar or removing it from Courrier deletes only its Android copy. Calendar permission is required; these copies are outside the vault and accessible to other apps with that permission. A calendar already synchronized by Android may appear twice. The selection is specific to each device; IMAP/SMTP and JMAP do not provide calendars in Courrier.

## CalDAV tasks

Dated tasks from CalDAV servers, including OpenTodo, appear in the calendar view, search, and details. You can enter the server address (`/dav/`), a calendar folder, or a list: Courrier discovers accessible lists using the CalDAV credentials. To create events, add a collection that supports events directly.

Only incomplete, non-cancelled tasks with a due date (or, if absent, a start date) are displayed. A date without a time occupies the whole day; a time creates a 30-minute marker without changing the task's duration on the server. For recurring tasks, only the current due date is displayed.

The details show the project (the CalDAV list) and labels received from the server (`CATEGORIES`), separately from Courrier's local tags. Dragging and dropping editable tasks shifts their start and due dates together, preserving their format and time zone. **Edit task** lets you change the title, dates in their original time zone, and description, and mark the task as complete. A completed recurring task may advance to its next due date depending on the server. The project, labels, recurrence, reminders, and other properties are preserved; moving tasks between projects and editing labels must be done in the original application. Saving requires a server version: a conflict blocks the write and offers an explicit choice to reload the remote version and discard your edits, or close without saving. Access without write permission, Courrier shared subscriptions, and servers without a usable version remain read-only. This support covers CalDAV/Nextcloud on web, desktop, and Android; it does not add task synchronization for Gmail, Exchange/EWS, IMAP/SMTP, or JMAP.

## Recurring events

Google Calendar, Exchange/EWS, and CalDAV/Nextcloud support daily, weekly, monthly, yearly, and weekday recurrence. Customization offers an interval, days of the week, and an end condition (never, a date, or a number of occurrences). Exchange limits the yearly interval to one year. A new rule replaces the recurrence for the entire series; existing rules are preserved if left unchanged. CalDAV series with specific times are currently defined in UTC: their local time may change when daylight saving time starts or ends. IMAP/SMTP and JMAP do not provide calendars in Courrier; ICS subscriptions are read-only.

From the calendar's left sidebar, **Add a shared calendar** lets you search for a person by name (when a directory is available) or email address. Suggestions show the provider and account color. Selected calendars appear under **Other calendars**: they are read-only, with customizable colors, visibility controls, and removal available from the sidebar. Their events cannot be tagged and are excluded from time calculations, even if another copy of the same event has a tag. References, colors, and visibility settings are synchronized across devices through the encrypted WebDAV configuration; events are not uploaded to WebDAV.

Discovery respects permissions granted by the server: Google offers the primary calendar accessible by email address and shared calendars already in the account's calendar list (the API cannot enumerate all of another person's calendars). The Workspace directory requires `directory.readonly` consent, potentially signing in again, and organization permissions. Exchange/EWS offers the primary calendar and additional folders when enumeration is permitted. CalDAV/Nextcloud uses people search and accessible collections in their calendars; the server must expose this directory and grant read access to the collections. For the primary Exchange/EWS calendar, if direct event access is denied, Courrier uses the same availability service as the meeting scheduling assistant: busy periods remain visible, with titles and locations only when Exchange permits them. Private appointments remain anonymous in this view. This fallback never substitutes the primary calendar for a secondary calendar. Google and CalDAV access limited to availability only is not supported. IMAP/SMTP and JMAP do not provide calendars in Courrier; ICS subscriptions remain available separately.

## Online meetings

When creating a Google Calendar or Exchange/EWS event, a toggle enabled by default adds Google Meet or Microsoft Teams, respectively. The Teams link is generated through Microsoft Graph and added to the description and EWS invitations; the account requires a Teams license and `OnlineMeetings.ReadWrite` consent (signing in again or administrator approval may be necessary). If generation fails, event creation stops and the error is displayed; disabling the toggle lets you create a regular event. The link is preserved when editing. The Teams meeting is independent: deleting it in Teams is not synchronized with deletion of the EWS event. CalDAV/Nextcloud does not generate conferences; IMAP/SMTP and JMAP do not provide calendars in Courrier.

A counterproposal received by email can be handled with the “Accept” and “Decline” buttons. The existing appointment is identified automatically. Accepting moves that appointment to the proposed time and frees the original slot without creating a duplicate, on Google Calendar, Exchange/EWS, and CalDAV/Nextcloud. Declining keeps the original appointment and sends a reply to the person who made the proposal through the email account. CalDAV delivery depends on the server's scheduling service. IMAP/SMTP and JMAP can receive the email but do not themselves provide a calendar.

From event details, either in the calendar or in a received invitation preview, “Email participants” opens a draft with the organizer as the recipient and the other participants copied, excluding addresses belonging to your configured accounts. The Gmail or Exchange account linked to the calendar is used; for CalDAV and ICS, an email account matching the calendar's address must be configured (including IMAP/SMTP and JMAP). Focus moves to the To field if it is empty, otherwise to the subject. Saving and sending then use the regular composer.

## Development

```bash
cd frontend
npm install
npm run dev
```

In a second terminal:

```bash
cd backend
cargo run
```

## Tests

```bash
cd frontend && npm test && npm run build
cd ../backend && cargo test
```

## Native applications

From Android's **Share** menu, choose **Courrier** to prepare a new email: shared files become attachments (up to 25 MB in total), text or a link fills the body, and the subject is used if provided. The shared draft is stored locally in the encrypted vault and can be resumed with **New message**; it is not synchronized with server drafts. Subsequent shares wait until this draft is sent or deleted. This works with Gmail, Exchange/EWS, IMAP/SMTP, and JMAP; CalDAV/Nextcloud is calendar-only.

Android connects directly to Gmail, Exchange/EWS, IMAP/SMTP, JMAP, and CalDAV/Nextcloud through the embedded Rust core:

```bash
./scripts/build-android-apk.sh --debug --skip-install
```

Desktop reuses the same core and produces a bundle for the current operating system:

```bash
cd frontend
npm run desktop:build:fast # local iteration, without an installer
npm run desktop:build
```

See [docs/android.md](docs/android.md) and [docs/desktop-native.md](docs/desktop-native.md). The Axum server is used only for the Web/PWA distribution and is not embedded in any native application.

## Docker

Run the build from the repository root:

```bash
docker build --build-arg APP_COMMIT_ID="$(git rev-parse --short HEAD)" --build-arg APP_COMMIT_DATE="$(git log -1 --format=%cI)" --file Dockerfile --tag courrier:latest .
docker run --rm --publish 127.0.0.1:8080:8080 courrier:latest
```

Then open `http://127.0.0.1:8080`. The correct image displays `Courrier listening on http://0.0.0.0:8080` at startup; it does not run Nginx inside the container.

### Local HTTPS testing

The vault uses Web Crypto. `localhost` works over HTTP, but access through an IP address or hostname requires HTTPS with a certificate trusted by the browser.

With `mkcert` installed:

```bash
mkcert -install
mkdir -p deploy/certs
mkcert -cert-file deploy/certs/localhost.pem \
  -key-file deploy/certs/localhost-key.pem \
  localhost 127.0.0.1 ::1
./scripts/update-all.sh
```

Then open `https://localhost:8443`. There should be no certificate warning. Local certificates are ignored by Git.

### Updating containers after a change

From the project root:

```bash
./scripts/update-frontend.sh  # React/CSS/translation changes
./scripts/update-backend.sh   # Rust/API/provider changes
./scripts/update-all.sh       # changes in both parts
```

The scripts run the relevant tests, rebuild the image using Docker caches, restart the local HTTPS stack, and display its status. Useful options:

```bash
SKIP_TESTS=1 ./scripts/update-frontend.sh
COURRIER_LOCAL_HTTPS=0 ./scripts/update-backend.sh
```

The first build initializes the Node and Cargo caches. Subsequent builds are
incremental and use the fast `local` Rust profile. The compiler and Alpine
tools come directly from the official `rust:1.91-alpine3.23` image: no `apk add`
or `rustup` download runs during the build. To simply restart the containers
without rebuilding the image:

```bash
docker compose -f compose.yaml -f compose.local-https.yaml up --detach
```

Only add `--build` after changing code or dependencies. The production build
without overrides retains the `release` Rust profile.

The recommended hardened setup uses:

```bash
COURRIER_LOCAL_HTTPS=0 ./scripts/update-all.sh
```

The port is then bound only to `127.0.0.1`. Nginx already installed on the host terminates HTTPS and applies Basic Auth. Examples are available in:

- `deploy/nginx-courrier.conf.example`
- `deploy/courrier-proxy-headers.conf`

Create the password file with a bcrypt hash:

```bash
htpasswd -cB -C 12 /etc/nginx/secrets/courrier.htpasswd mon-utilisateur
```

## Server configuration

The main variables are:

- `COURRIER_PUBLIC_URL`: public HTTPS URL;
- `COURRIER_ALLOWED_PROVIDER_HOSTS`: comma-separated list of allowed CalDAV/ICS hosts;
- `COURRIER_GOOGLE_CLIENT_ID` and `COURRIER_GOOGLE_CLIENT_SECRET`: credentials for a Google OAuth client of type “Web application”;
- `COURRIER_GOOGLE_REDIRECT_URI`: for example, `https://courrier.example.com/auth/google/callback`. The same URL must be added to the client's authorized redirect URIs in Google Cloud Console.

## Architecture

```text
Android (Capacitor/JNI) -----\
Desktop (Tauri) -------------+-> provider-core Rust -> remote services
Web/PWA -> Axum (adapter) ---/
```

See `docs/architecture.md` for security boundaries and migration details.

## License

MIT
