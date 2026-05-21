# Courrier — Instructions Claude Code

Application desktop mail + calendrier. **Tauri 2** (Rust) + **React/TypeScript** (Vite).
Produit : `com.courrier.app`, fenêtre principale 1280×800.

## Commandes

```bash
cd frontend && npm run tauri dev   # dev (lance Vite + Rust en watch)
cd frontend && npm run build       # build frontend seul
```

## Arborescence clé

```
frontend/
  src/
    App.tsx                         # Providers + routing (/ /calendar /config)
    i18n.ts                         # Config react-i18next
    index.css                       # CSS global, design tokens (custom props)
    main.tsx                        # Point d'entrée React
    shared/
      types.ts                      # Types partagés : CalendarEvent, CalendarConfig, GoogleAccount, ExchangeAccount, ImapAccount, JmapAccount
      store/
        GoogleAuthStore.tsx         # Comptes Google (calendrier + mail)
        ExchangeAuthStore.tsx       # Comptes EWS/Exchange
        ImapAuthStore.tsx           # Comptes IMAP
        JmapAuthStore.tsx           # Comptes JMAP
        ThemeStore.tsx              # Thème (light/dark/system)
        LanguageStore.tsx           # Langue (fr/en)
        LayoutStore.tsx             # Layout tabbed vs windows
        FontSizeStore.tsx           # Taille de police
      components/
        AppTabs.tsx                 # Barre onglets mail/calendrier (mode tabbed)
        WindowSwitcher.tsx          # Bouton switch fenêtre (mode windows)
      utils/
        tauriOAuth.ts               # Helpers OAuth via Tauri
      queryClient.ts                # React Query client + IndexedDB persister
    features/
      calendar/
        CalendarPage.tsx            # Page principale calendrier (orchestration)
        components/
          AppHeader.tsx             # En-tête avec navigation de date et sélecteur de vue
          Sidebar.tsx               # Panneau latéral : mini-calendrier + liste des agendas
          MiniCalendar.tsx          # Mini calendrier de navigation
          EventModal.tsx            # Modal consultation d'événement (dialog natif)
          CreateEventModal.tsx      # Modal création/édition d'événement
          RecurringChoiceModal.tsx  # Choix édition occurrence vs série
          SearchModal.tsx           # Modal recherche calendrier
          SearchResultsView.tsx     # Liste des résultats de recherche
          TagInsightsView.tsx       # Vue analytics par tag
          DayEventsTimeline.tsx     # Timeline journalière
          FreeBusyGrid.tsx          # Grille disponibilité participants
          AttendeeInput.tsx         # Champ participants avec autocomplétion
        hooks/
          useCalendarLogic.ts       # Logique principale (état, CRUD, sélection)
          useCalendarQueries.ts     # React Query pour les événements
          useGoogleEvents.ts        # Provider Google Calendar
          useEventKitEvents.ts      # Provider EventKit (macOS uniquement)
          useEWSEvents.ts           # Provider Exchange/EWS
          useICSEvents.ts           # Provider ICS/CalDAV
          useNextcloudEvents.ts     # Provider Nextcloud
        store/
          CalendarStore.tsx         # Liste des agendas configurés
          CalendarGroupStore.tsx    # Groupes d'agendas
          TagStore.tsx              # Tags locaux pour events
          defaultCalendarStore.ts   # Agenda par défaut pour création
        utils/
          calendarUtils.ts          # Utilitaires date/heure
          eventCache.ts             # Cache local événements
          googleCalendarApi.ts      # Appels REST Google Calendar API
          ewsApi.ts                 # Appels EWS (Exchange Web Services)
          nextcloudCalendarApi.ts   # Appels CalDAV Nextcloud
          parseICS.ts               # Parser ICS
      mail/
        MailPage.tsx                # Page principale mail (orchestration)
        types.ts                    # Types mail : MailThread, MailMessage, MailFolder, MailAttachment, MailSearchQuery
        utils.ts                    # Helpers mail (ALL_ACCOUNTS_ID, DISPLAY_TO_STATIC, etc.)
        providers/
          MailProvider.ts           # Interface MailProvider + types SendMailParams, SaveDraftParams
          EwsMailProvider.ts        # Implémentation EWS
          GmailMailProvider.ts      # Implémentation Gmail (via Tauri invoke)
          ImapMailProvider.ts       # Implémentation IMAP (via Tauri invoke)
          JmapMailProvider.ts       # Implémentation JMAP (via Tauri invoke)
          useMailProvider.ts        # Hook qui instancie le bon provider selon le compte
        hooks/
          useMailPageLogic.ts       # Logique principale mail (état, providers, actions)
          useMailQueries.ts         # React Query (threads, folders, conversation, search)
          useMailMutations.ts       # Mutations React Query (send, trash, move, etc.)
          useContactSuggestions.ts  # Autocomplétion contacts
          useDockBadge.ts           # Badge non-lus dans le dock macOS
        components/
          MailSidebar.tsx           # Barre latérale : comptes + dossiers
          ThreadList.tsx            # Liste des fils de discussion
          ThreadDetail.tsx          # Panneau de lecture : messages empilés
          ThreadItem.tsx            # Ligne de fil dans la liste
          MessageBlock.tsx          # Un message dans ThreadDetail
          MessageBlockHeader.tsx    # En-tête d'un message (expéditeur, date, etc.)
          MailComposer.tsx          # Fenêtre de composition (reply/forward)
          NewMessageComposer.tsx    # Fenêtre nouveau message
          MailEditor.tsx            # Éditeur riche Tiptap
          MailSearchBar.tsx         # Barre de recherche mail
          RecipientInput.tsx        # Champ destinataires avec chips
          ContactDropdown.tsx       # Dropdown suggestions contacts
          AttachmentList.tsx        # Liste pièces jointes dans un message
          AttachmentPreviewModal.tsx # Preview in-app des pièces jointes
          ComposerAttachmentPanel.tsx # Pièces jointes dans le compositeur
          ICSInvitationCard.tsx     # Carte invitation calendrier dans un mail
          FolderPickerPopover.tsx   # Popover choix de dossier (déplacer)
          CollapsedMessagesBar.tsx  # Barre "N messages réduits"
          MultiSelectionPanel.tsx   # Panneau actions multi-sélection
        utils/
          emailQuoteParser.ts       # Parser de citations email (reply/forward)
    pages/
      CalendarPage.tsx              # Ancienne page calendrier (re-export ou legacy)
      ConfigPage.tsx                # Page configuration (comptes, thème, langue, layout)
      ImapAccountManageModal.tsx    # Modal config compte IMAP
      JmapAccountManageModal.tsx    # Modal config compte JMAP
    locales/
      en/translation.json           # Traductions anglaises
      fr/translation.json           # Traductions françaises
    demo/
      demoData.ts                   # Données de démo (VITE_DEMO_MODE=true)
  src-tauri/src/
    lib.rs                          # Point d'entrée Tauri + commandes utilitaires (save_file_to_downloads, open_file_path)
    auth.rs                         # OAuth helpers (start_oauth_listener, wait_oauth_code)
    gmail.rs                        # Commandes Tauri Gmail
    imap.rs                         # Commandes Tauri IMAP + SMTP
    jmap.rs                         # Commandes Tauri JMAP
    mail_provider.rs                # trait MailProvider + types canoniques Rust (MailThread, MailMessage, MailFolder, MailAttachment, MailItemRef, MailIdentity, ComposerAttachment, SendMailParams, SaveDraftParams, MailSearchQuery)
    mail.rs                         # EwsProvider + impl MailProvider (EWS/Exchange)
    imap.rs                         # ImapProvider + impl MailProvider (IMAP/SMTP)
    jmap.rs                         # JmapProvider + impl MailProvider + JmapClientState (cache connexions)
    ews/
      mod.rs                        # Commandes Tauri EWS
      calendar.rs                   # Commandes Tauri EWS calendrier
    http.rs                         # Client HTTP bas niveau (fetch_caldav_status, etc.)
    eventkit.rs                     # EventKit macOS (fetch_eventkit_events, create_eventkit_event)
```

## Architecture & patterns

### Layout
- **`tabbed`** : une seule fenêtre avec onglets Mail / Calendrier
- **`windows`** : Mail dans la fenêtre principale, bouton pour ouvrir/focus une 2e fenêtre Calendrier (`/calendar`)
- Route `/config` : page de configuration standalone

### State management
- **Stores** = React Context + localStorage (pattern : `useFoo()` hook + `FooProvider`)
- **Async data** = React Query v5 avec persistance IndexedDB (`queryClient.ts`)
- Les mutations utilisent `useMailMutations` (mail) et les fonctions dans `useCalendarLogic` (calendrier)

### Providers mail
L'architecture est symétrique côté TypeScript et Rust :

**TypeScript** — tous les providers implémentent `interface MailProvider` (`features/mail/providers/MailProvider.ts`).
Pour ajouter un provider TS : créer une classe, l'instancier dans `useMailProvider.ts`, ajouter un store d'auth dans `shared/store/`.

**Rust** — tous les providers implémentent `trait MailProvider` (`src-tauri/src/mail_provider.rs`).
Les types canoniques (MailThread, MailMessage, MailFolder, MailAttachment, etc.) sont définis une seule fois dans `mail_provider.rs` et importés par `mail.rs` (EWS), `imap.rs` et `jmap.rs`.
Les commandes Tauri sont de fines enveloppes qui instancient le bon `XxxProvider` et délèguent au trait.
Pour ajouter un provider Rust : créer un struct, implémenter `MailProvider`, enregistrer les commandes dans `lib.rs`.

> Gmail est une exception : son provider est entièrement côté TypeScript ; `gmail.rs` ne contient que 2 helpers d'attachements.

### Providers calendrier
Chaque source = un hook `useXxxEvents(calendars, dateRange)` → renvoie `CalendarEvent[]`.
L'agrégation se fait dans `useCalendarLogic.ts`.

### Tauri commands
Les appels Rust se font via `invoke('command_name', params)` depuis `@tauri-apps/api/core`.
Les commandes sont définies dans les fichiers `.rs` et enregistrées dans `lib.rs` (fonction `run()`).

## Règles obligatoires

1. **i18n** : tout libellé visible doit passer par `useTranslation()` → `t('clé')`.
   Ajouter la clé dans **les deux fichiers** :
   - `frontend/src/locales/fr/translation.json`
   - `frontend/src/locales/en/translation.json`

2. **Design tokens CSS** : utiliser les custom properties définies dans `index.css` (`--primary`, `--bg`, `--text`, `--border`, etc.) — ne pas coder de couleurs en dur.

3. **Thème** : les classes `.dark` ne s'appliquent pas ; c'est l'attribut `[data-theme="dark"]` sur `<html>` qui active le thème sombre.

## Types essentiels (référence rapide)

| Type | Fichier |
|------|---------|
| `CalendarEvent` | `shared/types.ts` |
| `CalendarConfig` | `shared/types.ts` |
| `GoogleAccount`, `ExchangeAccount`, `ImapAccount`, `JmapAccount` | `shared/types.ts` |
| `MailThread`, `MailMessage`, `MailFolder`, `MailAttachment` | `features/mail/types.ts` |
| `MailProvider`, `SendMailParams`, `ComposerAttachment` | `features/mail/providers/MailProvider.ts` |
| `MailSearchQuery` | `features/mail/types.ts` |
