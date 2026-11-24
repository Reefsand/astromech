# Astromech

Un petit droïde de bureau qui suit le travail de tes assistants IA : il s'agite quand
Claude (ou Codex) travaille, avec derrière lui un écran par discussion en cours.

- **Bleu** : l'assistant travaille, du code s'écrit à l'écran.
- **? jaune** : il te pose une question.
- **! rouge** : il attend une action de ta part (une autorisation par exemple).
- **✓ vert** : c'est terminé.

Un petit bip différent accompagne chaque « ? », « ! » et « ✓ ».

Deux morceaux, utilisables séparément :

| | Ce que c'est | Où il s'affiche |
|---|---|---|
| **Le mod** (`hooks/`) | un mod Claude Code | dans la colonne de droite de l'app Claude |
| **Le droïde flottant** (`desktop/`) | une petite app Mac | au-dessus de toutes les fenêtres, déplaçable |
| **Le droïde flottant pour PC** (`pc/`) | une petite app Windows | pareil, sur Windows : voir [pc/README.md](pc/README.md) |

## Installer le mod (Claude Code)

Dans Claude Code :

```
/plugin install astromech --marketplace Reefsand/astromech
```

Puis `/astromech` ouvre le droïde.

## Installer le droïde flottant (Mac)

Il faut macOS 13 ou plus, les outils de développement d'Apple (`xcode-select --install`) et Node 22 ou plus.

```bash
git clone https://github.com/Reefsand/astromech.git
zsh astromech/desktop/build.sh
open ~/Applications/Astromech.app
```

Il lit, sans rien y modifier :
- les sessions Claude Code (`~/.claude/projects`, et l'état précis envoyé par le mod) ;
- les discussions Codex de l'app ChatGPT ou de la ligne de commande (`~/.codex/sessions`).

Rien ne quitte ton Mac.

## Installer le droïde flottant (PC)

Lance `Astromech-Setup-0.1.0.exe`, construit par `npm run dist` dans `pc/`. Tout est
expliqué dans [pc/README.md](pc/README.md) (raccourcis Ctrl+Alt+R et Ctrl+Alt+M).

## Commandes

| | Raccourci | Dans Claude | Terminal |
|---|---|---|---|
| Cacher / montrer | ⌃⌥R | `/astromech cacher`, `/astromech montrer` | `open -g astromech://toggle` |
| Couper / remettre le son | ⌃⌥M | `/astromech muet`, `/astromech son` | `open -g astromech://sound` |

- Glisser le droïde le déplace.
- Double-cliquer sur un écran ouvre sa discussion (dans Claude ou dans ChatGPT).
- Le menu dans la barre des menus règle la taille et l'ouverture au démarrage.

## Licence

MIT
