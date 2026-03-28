# Calendar Desktop

A native desktop calendar application built with [Tauri](https://tauri.app/) and React, supporting both macOS native calendars (via EventKit) and Google Calendar.

## Features

- View and manage events from macOS native calendars (EventKit)
- Google Calendar integration via OAuth2 (PKCE flow)
- Month, week, and day views powered by Toast UI Calendar
- Event creation, editing, and deletion
- Docker support for web deployment

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install)
- [Node.js](https://nodejs.org/) (v18+)
- macOS (for native EventKit support)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/yawks/calendar-desktop.git
cd calendar-desktop
```

### 2. Configure environment variables

```bash
cp .env.example frontend/.env
```

Edit `frontend/.env` and fill in your Google OAuth credentials:

- `VITE_GOOGLE_CLIENT_ID` — Desktop app client ID (Google Cloud Console → Credentials → Desktop application)

### 3. Install dependencies and run

```bash
cd frontend
npm install
npm run tauri dev
```

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create a **Desktop application** OAuth client
3. Copy the Client ID into `VITE_GOOGLE_CLIENT_ID` in your `.env` file

## Docker (Web Deployment)

For web deployment, additional credentials are required (see `.env.example`):

```bash
docker compose up
```

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 |
| Frontend | React 18 + TypeScript + Vite |
| Calendar UI | Toast UI Calendar |
| Native calendars | EventKit (macOS, via Rust/objc2) |
| Google Calendar | OAuth2 PKCE + Google Calendar API |

## License

MIT
