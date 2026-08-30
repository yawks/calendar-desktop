# Courrier — règles de contribution UI

Ce fichier s’applique à tout le dépôt. Toute modification d’interface doit rester visuellement cohérente entre web, desktop Tauri et Android Capacitor.

## Sources de vérité

- Les variables de thème existantes (`--bg`, `--bg-sidebar`, `--bg-hover`, `--text`, `--text-muted`, `--border`, `--primary`, `--danger`, `--shadow`) sont la source de vérité. Ne pas introduire une couleur codée en dur lorsqu’une variable sémantique existe.
- Les styles d’une page vivent dans sa feuille CSS existante. Pour la configuration, utiliser `frontend/src/pages/styles/config.css`; pour le shell responsive et l’écran de déverrouillage, utiliser `frontend/src/styles/responsive.css`.
- Prendre `NativeSettingsSection` et les classes `.native-settings-*` comme référence pour une carte de réglages comportant un titre, une description, une grille de champs, des actions et un statut.
- Prendre les modales de configuration (`NewCalendarModal`, `ImapAccountManageModal`, `JmapAccountManageModal`) comme référence pour les formulaires modaux.
- Les classes `.vault-*` sont réservées à l’écran plein de création/déverrouillage du coffre et à ses diagnostics. Elles ne doivent pas être réutilisées dans une page de préférences, une modale ou une carte.

## Composition attendue

Avant d’ajouter du JSX, identifier l’un des contextes suivants et reprendre son pattern complet :

1. **Section simple de préférences** : utiliser elle aussi une `.native-settings-card`; l'onglet Préférences ne mélange pas des blocs nus et des cartes.
2. **Carte de réglages structurée** : `.native-settings-card`, en-tête `.native-settings-card__header`, icône `.native-settings-card__icon`, grille `.native-settings-grid`, champs `.native-settings-field`, actions `.native-settings-actions`.
3. **Formulaire modal** : `.config-form`, grille de formulaire existante et footer d’actions séparé par une bordure.
4. **Écran plein sensible** : composants et classes propres à cet écran, comme `.vault-form`; ne pas en extraire un sélecteur contextualisé pour un autre écran.

Si aucun pattern ne convient, créer un composant et des classes sémantiques dédiés dans la feuille CSS de la fonctionnalité. Ne pas assembler une nouvelle interface principalement avec des styles inline.

## Formulaires

- Un champ est composé d’un `label` englobant ou relié par `htmlFor`, d’un libellé visible et du contrôle.
- Dans une grille, chaque champ doit avoir `min-width: 0`; chaque `input`, `select` ou `textarea` doit avoir `width: 100%` et `box-sizing: border-box`.
- Les grilles utilisent `grid-template-columns: repeat(2, minmax(0, 1fr))` sur écran large et une seule colonne sur écran étroit.
- Ne jamais dépendre d’un sélecteur parent absent. Exemple interdit : employer `.vault-fields` hors de `.vault-form` alors que les règles des labels et inputs sont définies par `.vault-form label` et `.vault-form input`.
- Hauteur cible des contrôles : 42 à 44 px. Rayon courant : 8 px. Padding courant : 9–11 px.
- L’état focus doit être visible avec `--primary` et un halo `color-mix`, conformément à `.native-settings-field`.
- Utiliser les attributs `autocomplete`, `type`, `required`, `disabled` et les contraintes appropriées. Un placeholder ne remplace jamais un libellé.
- Les secrets sont des champs `password`; une clé de récupération peut être monospace et doit pouvoir être copiée sans être tronquée.

## Boutons et actions

- Réutiliser `btn-primary`, `btn-ghost` et les variantes existantes avant de créer un nouveau bouton.
- Une zone d’actions est un flex avec retour à la ligne et gap régulier; elle ne doit pas remplir toute la largeur sauf dans une modale ou un écran mobile où cela est intentionnel.
- L’action principale apparaît en premier. Les actions destructrices ou de déconnexion sont visuellement séparées et ne doivent pas ressembler à l’action principale.
- Les boutons asynchrones exposent un état occupé, sont désactivés pendant l’opération et conservent une largeur stable autant que possible.
- Toute icône de bouton est généralement en 15–16 px et accompagnée d’un texte, sauf action universellement compréhensible avec `aria-label` et `title`.

## Typographie et espacements

- Toute taille de texte applicative respecte `var(--font-scale)` via `calc(... * var(--font-scale, 1))`.
- Titre d’une section de préférences : environ 15–16 px, graisse 600, icône alignée, gap 8 px.
- Texte d’aide : environ 12 px, `--text-muted`, hauteur de ligne autour de 1.45. Éviter de cumuler une couleur atténuée et une opacité très faible au point de dégrader le contraste.
- Espacement entre grandes sections : 28 px. Espacement titre/aide/champs : 8–12 px. Gap de grille : 12–14 px.
- Éviter les marges implicites des éléments HTML : définir les marges des `h*`, `p`, listes et figures dans le composant ou sa classe.

## Responsive et plateformes

- Toute nouvelle grille ou carte doit être testée au minimum à 320 px, 480 px et 1024 px de largeur.
- Sous 600 px, une grille de formulaire passe sur une colonne et les actions peuvent s’empiler ou occuper toute la largeur.
- Dans les onglets de réglages, chaque groupe fonctionnel est une carte homogène : même bordure, fond, rayon, en-tête avec `.native-settings-card__icon`, titre et aide éventuelle. Ne pas laisser une section nue entre des cartes.
- Sur mobile, compacter les cartes avant de supprimer de l'information : padding intérieur cible de 12 à 14 px, espacement entre cartes de 14 à 16 px, icône d'en-tête de 34 à 36 px et gap d'en-tête de 10 à 12 px. Conserver au moins 44 px pour toute cible tactile.
- Éviter le cumul de marges entre conteneur et carte. Une seule règle doit porter l'espacement vertical entre deux cartes afin de ne pas créer de doubles espaces.
- Les aperçus décoratifs peuvent être réduits en hauteur sur mobile, mais les libellés, aides, statuts et contrôles ne doivent pas être masqués.
- Tenir compte des zones sûres mobiles (`env(safe-area-inset-*)`) uniquement au niveau du shell ou des écrans plein format, pas dans chaque carte.
- Ne pas supposer qu’un desktop possède une caméra ni qu’un mobile possède un clavier physique. Toujours fournir une alternative manuelle au QR ou au scan.
- Éviter les règles uniquement basées sur le survol : chaque action doit fonctionner au toucher et au clavier.

## États, retours et erreurs

- Chaque opération distante possède les états minimum : repos, chargement, succès, erreur; ajouter conflit lorsque les données sont versionnées.
- Un succès utilise `role="status"`; une erreur bloquante utilise `role="alert"`.
- Les messages d’erreur restent près de la zone d’action concernée et ne réutilisent pas une classe d’un autre écran uniquement pour obtenir une couleur rouge.
- Un conflit doit expliquer les conséquences des deux choix. Aucune fusion, suppression ou écrasement ne doit être silencieux.
- Ne jamais rendre deux fois le même message d’état.

## Internationalisation et contenu

- Tout texte visible passe par `react-i18next` et existe au minimum en français et en anglais.
- Ne pas utiliser un texte anglais comme fallback dans un nouvel écran français. Les fallbacks existants ne sont pas un modèle à reproduire.
- Les libellés doivent décrire l’action ou la donnée, pas son implémentation technique. Les détails WebDAV, ETag ou chiffrement vont dans l’aide lorsque l’utilisateur en a besoin.
- Prévoir l’allongement des traductions : pas de largeur fixe pour un libellé ou un bouton contenant du texte.

## Discipline CSS et JSX

- Préférer des classes sémantiques et regroupées par fonctionnalité aux longs objets `style={{ ... }}` répétés.
- Un style inline est acceptable pour une valeur réellement dynamique; il ne doit pas servir à définir toute la mise en page d’une nouvelle section.
- Ne pas créer une classe générique à partir d’un seul usage. Préférer un préfixe de fonctionnalité (`config-sync-*`, `native-settings-*`, etc.).
- Ne pas modifier globalement `input`, `button`, `label` ou `p` pour corriger un écran local.
- Avant de réutiliser une classe, lire toutes ses règles et ses sélecteurs parents dans les feuilles CSS. La présence du nom de classe dans le JSX ne garantit pas que ses styles descendants s’appliqueront.
- Extraire un composant lorsque le même groupe titre/aide/champs/actions est utilisé plusieurs fois ou lorsque le JSX devient difficile à relire.

## Validation obligatoire

Avant de considérer une modification UI terminée :

1. lancer `npm run build` dans `frontend`;
2. vérifier le thème clair et le thème sombre;
3. vérifier clavier, focus visible et lecture des statuts;
4. vérifier les largeurs 320, 480 et 1024 px;
5. vérifier que labels, inputs et boutons ne se chevauchent pas et qu’aucun texte n’est tronqué;
6. vérifier les traductions française et anglaise;
7. pour une modification Android, construire l’APK et inspecter l’écran sur un appareil ou émulateur;
8. pour un écran sensible, confirmer qu’aucun secret n’apparaît dans les logs, URL HTTP, diagnostics ou captures générées automatiquement.

Une capture visuelle ou une inspection sur appareil fait partie de la validation lorsqu’une section est nouvelle ou que sa structure change sensiblement.
