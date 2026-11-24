# Astromech pour PC (Windows)

Le droïde flottant, version Windows : même dessin (celui du mod, `hooks/svg.ts`), mêmes
règles et mêmes commandes que l'app Mac. C'est une petite app Electron.

## Installer

Lance `Astromech-Setup-0.1.0.exe` : il s'installe pour ton compte seulement, sans droits
administrateur, puis s'ouvre. Le droïde apparaît en bas à droite de l'écran, et une petite
tête de droïde s'ajoute dans la zone de notification, près de l'horloge.

Sinon, le zip portable (`Astromech-0.1.0-portable.zip`) : à décompresser n'importe où, puis
ouvrir `Astromech.exe`.

L'app n'est pas signée : au premier lancement, Windows SmartScreen peut afficher
« Windows a protégé votre ordinateur ». Clique sur « Informations complémentaires » puis
« Exécuter quand même ».

## Ce qu'il lit

Sans rien y modifier, dans ton dossier utilisateur (`C:\Users\<toi>`) :
- `.claude\astromech\sessions` : l'état précis envoyé par le mod ;
- `.claude\projects` : les sessions Claude Code ;
- `.codex\sessions` : les discussions Codex ;
- `%APPDATA%\Claude\claude-code-sessions` : les titres et les sessions archivées de l'app Claude.

Rien ne quitte ton PC.

## Commandes

| | Raccourci | Dans Claude | Invite de commandes |
|---|---|---|---|
| Cacher / montrer | Ctrl+Alt+R | `/astromech cacher`, `/astromech montrer` | `start astromech://toggle` |
| Couper / remettre le son | Ctrl+Alt+M | `/astromech muet`, `/astromech son` | `start astromech://sound` |

- Glisser le droïde le déplace.
- Double-cliquer sur un écran ouvre sa discussion (dans Claude ou dans ChatGPT) ;
  sur le droïde, ouvre Claude.
- Clic sur l'icône de notification : cacher ou montrer le droïde. Clic droit : le menu
  (taille, sons, ouverture au démarrage, remettre en bas à droite, quitter).

## Différence avec le Mac

Sur Mac, un écran « terminé » disparaît aussi dès que sa discussion est affichée dans l'app
Claude au premier plan. Sur PC, il disparaît quand tu l'ouvres (double-clic, ou en la
sélectionnant dans Claude), ou au bout de 10 minutes.

## Construire

Il faut Node 22 ou plus. Depuis un Mac ou un PC :

```bash
cd pc
npm install
npm run dist
```

Résultat dans `pc/dist/` : l'installeur `.exe` et le zip portable. Sur Mac, il n'y a pas
besoin de Wine : l'icône et le nom de l'exe sont posés par `after-pack.cjs`.

- `npm start` lance le droïde sur la machine où tu es (utile pour essayer sur Mac aussi).
- `npm run snapshot -- image.png` écrit ce que le droïde dessine dans `image.png`, puis quitte.
