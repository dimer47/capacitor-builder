# Plan — Ajouter la génération de CHANGELOG.md dans capacitor-builder

## Contexte

capacitor-builder génère déjà un changelog IA au format store (texte brut, terminal).
electron-release-builder (le projet frère pour Electron) a en plus :
- La génération d'un fichier CHANGELOG.md (format markdown)
- Le cumul des versions (chaque release s'ajoute au-dessus des précédentes)
- Deux modes : terminal (store) et fichier (markdown)

On veut porter cette fonctionnalité dans capacitor-builder pour avoir la parité.

## Ce qui existe déjà dans capacitor-builder

- `--changelog` : génère le changelog IA au format store (terminal, max 500 chars)
- Providers : claude-api, gemini-api, claude-cli, codex-cli
- Fonction `generateChangelog()` dans index.mjs
- Fonction `getChangelogFromUser()` : propose utiliser/modifier/régénérer/passer
- Le changelog store est envoyé sur Google Play via les release notes

## Ce qu'il faut ajouter

### 1. Nouvelle commande `--changelog-file`

Génère le changelog et l'écrit dans CHANGELOG.md (format markdown).

Comportement :
- Appelle le provider IA avec un prompt **markdown** (titres ###, bullet points)
  au lieu du prompt **store** (majuscules, texte brut, 500 chars max)
- Le prompt markdown n'a pas de limite de 500 caractères
- Écrit/met à jour CHANGELOG.md :
  - Si la version existe déjà dans le fichier → remplace la section
  - Sinon → ajoute au-dessus du contenu existant
  - Header `# Changelog` en haut du fichier

### 2. Intégrer dans le flow de build (`--ios`, `--android`, `--both`)

Après la génération du changelog store (pour les stores) et avant le tag :
- Générer aussi le CHANGELOG.md (format markdown)
- L'ajouter au commit de version (`git add CHANGELOG.md`)

### 3. Nouveau script npm

Ajouter dans la doc/README pour les projets qui utilisent capacitor-builder :
```json
{
  "cb:changelog": "capacitor-builder --changelog",
  "cb:changelog:file": "capacitor-builder --changelog-file"
}
```

## Implémentation technique

### Option A : Réutiliser tools/changelog.mjs d'electron-release-builder

Copier le fichier `tools/changelog.mjs` d'electron-release-builder dans
capacitor-builder. Il contient déjà :
- `parseCommits()` : parse les commits conventionnels
- `groupByType()` : regroupe par feat/fix/chore/etc.
- `generateMarkdownClassic()` : fallback sans IA
- `buildPrompt(format)` : prompt adapté store vs markdown
- `generateWithProvider()` : codex-cli, anthropic, openai
- Logique d'écriture CHANGELOG.md avec cumul des versions

Adapter :
- Remplacer `import Logger` par le logger de capacitor-builder
- Remplacer la lecture de config (electron-release-builder.config.json)
  par capacitor-builder.config.json (même structure `changelog.*`)

### Option B : Factoriser dans un module partagé

Extraire la logique changelog dans un package npm partagé entre
electron-release-builder et capacitor-builder. Plus propre mais plus de travail.

**Recommandation : Option A** pour l'instant, Option B plus tard si nécessaire.

## Fichiers à modifier

| Fichier | Modification |
|---------|-------------|
| `tools/options.mjs` | Ajouter `--changelog-file` |
| `index.mjs` | Ajouter le handling de `--changelog-file` + intégrer dans le flow de build |
| `tools/changelog.mjs` | Créer (copier depuis electron-release-builder et adapter) |

## Référence

Le code source complet est dans :
- `/Users/iachi.dimitri/Work/Librairies/electron-release-builder/commands/changelog.mjs`
- `/Users/iachi.dimitri/Work/Librairies/electron-release-builder/tools/git.mjs`

## Tests

1. `capacitor-builder --changelog` → doit toujours fonctionner (store, terminal)
2. `capacitor-builder --changelog-file` → doit générer CHANGELOG.md
3. Build complet (`--ios` ou `--android`) → doit générer les deux (store + fichier)
4. Relancer `--changelog-file` sur la même version → doit remplacer, pas dupliquer
5. Nouvelle version → doit s'ajouter au-dessus de l'ancienne dans CHANGELOG.md
