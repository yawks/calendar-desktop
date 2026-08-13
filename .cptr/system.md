# Instructions pour les réponses

Dans les récapitulatifs et les réponses, référence les fichiers en texte brut,
avec un chemin relatif à la racine du dépôt et, si nécessaire, le numéro de
ligne au format suivant :

`frontend/src/shared/security/VaultProvider.tsx:62`

Ne génère jamais de lien Markdown vers un chemin de fichier local, qu'il soit
absolu ou relatif. En particulier, ne transforme pas les chemins situés sous
`/projects/calendar-desktop` en URL ou en lien cliquable.

## Accès GitHub

L'authentification SSH de ce dépôt est déjà configurée et fonctionnelle sur le
remote `origin` par l'intermédiaire de `core.sshCommand`.

La clé privée dédiée est montée dans
`/run/secrets/github/calendar-desktop` et le fichier des clés d'hôtes dans
`/run/secrets/github/known_hosts`.

Pour les opérations distantes, utilise exclusivement le remote `origin` et des
commandes Git ordinaires, par exemple :

```text
git fetch origin staging
git pull --ff-only origin staging
git push origin staging
```

Ne définis et ne remplace jamais `GIT_SSH_COMMAND`. N'utilise jamais une URL
HTTPS à la place du remote `origin`. Ne recherche pas de clé dans
`/root/.ssh`, ne modifie pas les propriétaires ou les permissions des secrets
SSH et n'utilise pas `StrictHostKeyChecking=accept-new`.

Si une opération distante échoue, commence par afficher
`git config --get core.sshCommand` et signale l'erreur exacte sans tenter de
reconfigurer SSH ni de rechercher d'autres identifiants.
