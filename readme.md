# Capacitor Builder

Outil CLI pour automatiser le build, le signing, l'upload et le versioning des applications Capacitor sur iOS et Android.

## Installation

```bash
npm install capacitor-builder
```

Ou depuis GitHub :

```bash
npm install github:dimer47/capacitor-builder
```

## Commandes

| Commande | Description |
|----------|-------------|
| `--ios` | Build et upload pour iOS |
| `--android` | Build et upload pour Android |
| `--both` | Build et upload pour iOS et Android |
| `--no-upload` | Build complet sans upload sur les stores |
| `--changelog` | Générer le changelog IA seul (sans build) |
| `--tag` | Tagger la version actuelle dans git |
| `--help` | Afficher l'aide |
| `-f, --force` | Ignorer les vérifications git (branche, fichiers non commités) |

### Exemples

```bash
# Build + upload les deux plateformes
node ./node_modules/capacitor-builder/index.mjs --both

# Build iOS sans upload
node ./node_modules/capacitor-builder/index.mjs --ios --no-upload

# Générer le changelog seul
node ./node_modules/capacitor-builder/index.mjs --changelog

# Tagger la version actuelle
node ./node_modules/capacitor-builder/index.mjs --tag
```

## Scripts npm recommandés

Ajoutez ces scripts dans le `package.json` de votre projet (préfixe `cb:` pour capacitor-builder) :

```json
{
  "scripts": {
    "cb:generate": "node ./node_modules/capacitor-builder/index.mjs --both",
    "cb:generate:no-upload": "node ./node_modules/capacitor-builder/index.mjs --both --no-upload",
    "ios:cb:generate": "node ./node_modules/capacitor-builder/index.mjs --ios",
    "ios:cb:generate:no-upload": "node ./node_modules/capacitor-builder/index.mjs --ios --no-upload",
    "android:cb:generate": "node ./node_modules/capacitor-builder/index.mjs --android",
    "android:cb:generate:no-upload": "node ./node_modules/capacitor-builder/index.mjs --android --no-upload",
    "cb:changelog": "node ./node_modules/capacitor-builder/index.mjs --changelog",
    "cb:tag": "node ./node_modules/capacitor-builder/index.mjs --tag",
    "cb:init": "node ./node_modules/capacitor-builder/index.mjs --init",
    "cb:help": "node ./node_modules/capacitor-builder/index.mjs --help",
    "cb:sync-version": "node ./node_modules/capacitor-builder/sync-version.mjs"
  }
}
```

## Configuration

Créez un fichier `capacitor-builder.config.json` à la racine du projet (**ajoutez-le au `.gitignore`** car il contient des secrets) :

```json
{
  "ios": {
    "teamId": "XXXXXXXXXX",
    "scheme": "App",
    "workspace": "ios/App/App.xcworkspace",
    "apiKeyPath": "/chemin/vers/AuthKey_XXXXXXXX.p8",
    "apiKeyId": "XXXXXXXX",
    "apiIssuerId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  },
  "android": {
    "packageName": "com.example.app",
    "keystorePath": "/chemin/vers/KeyStore.jks",
    "keystorePassword": "motdepasse",
    "keyAlias": "key0",
    "keyPassword": "motdepasse",
    "serviceAccountJsonPath": "/chemin/vers/service-account.json"
  },
  "changelog": {
    "provider": "claude-api",
    "apiKey": "sk-ant-...",
    "language": "fr"
  }
}
```

### Sans fichier de configuration

Si `capacitor-builder.config.json` n'existe pas, l'outil fonctionne en **mode legacy** : il ouvre Xcode (iOS) ou Android Studio (Android) au lieu de builder et uploader automatiquement.

## Sections de configuration

### iOS

| Champ | Description |
|-------|-------------|
| `teamId` | Apple Developer Team ID |
| `scheme` | Scheme Xcode (généralement `"App"`) |
| `workspace` | Chemin vers le `.xcworkspace` |
| `apiKeyPath` | Chemin vers la clé API App Store Connect (`.p8`) |
| `apiKeyId` | ID de la clé API |
| `apiIssuerId` | Issuer ID App Store Connect |

**Prérequis iOS :**
- Xcode installé avec les outils en ligne de commande
- Signing automatique configuré dans Xcode (`CODE_SIGN_STYLE = Automatic`)
- Clé API App Store Connect créée sur [appstoreconnect.apple.com](https://appstoreconnect.apple.com/access/integrations/api)

### Android

| Champ | Description |
|-------|-------------|
| `packageName` | Package name de l'application (ex: `com.example.app`) |
| `keystorePath` | Chemin absolu vers le fichier `.jks` de signing |
| `keystorePassword` | Mot de passe du keystore |
| `keyAlias` | Alias de la clé dans le keystore |
| `keyPassword` | Mot de passe de la clé |
| `serviceAccountJsonPath` | Chemin vers le JSON du service account Google Play |

**Prérequis Android :**
- Android SDK installé
- Un keystore `.jks` existant (créé via `keytool` ou Android Studio)
- Play App Signing activé sur la Google Play Console
- Un service account Google avec accès à l'API Android Publisher
- Le service account doit être invité comme utilisateur dans la Google Play Console avec les permissions développeur

**Note :** Le fichier `signing.properties` est créé temporairement pendant le build et supprimé ensuite. Il est aussi dans le `.gitignore` du dossier `android/`.

### Changelog IA

| Champ | Description |
|-------|-------------|
| `provider` | Provider IA à utiliser |
| `apiKey` | Clé API (requis pour les providers `*-api`) |
| `language` | Langue du changelog (défaut: `"fr"`) |

**Providers disponibles :**

| Provider | Description | Clé API requise |
|----------|-------------|-----------------|
| `claude-api` | API Anthropic (Claude) | Oui — [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| `gemini-api` | API Google Gemini (gratuit) | Oui — [aistudio.google.com](https://aistudio.google.com/apikey) |
| `claude-cli` | Claude Code CLI (`claude -p`) | Non (utilise la CLI locale) |
| `codex-cli` | Codex CLI (`codex exec`) | Non (utilise la CLI locale) |
| `none` | Désactivé | — |

Le changelog est limité à **500 caractères** (limite Google Play Store). Il est généré à partir des commits git depuis le dernier tag.

**Pendant le build :** le changelog est proposé à l'utilisateur qui peut l'utiliser tel quel, le modifier, le régénérer ou le passer. Il est envoyé avec l'upload Android (notes de version du canal internal).

## Workflow de build

Quand vous lancez un build (`--ios`, `--android` ou `--both`), voici les étapes :

1. **Vérifications git** — branche main, fichiers non commités (sauf `--force`)
2. **Bump de version** — choix interactif : major / minor / patch + numéro de build
3. **Changelog IA** — génération et validation (si configuré)
4. **Build web** — `npm run build` (Nuxt generate)
5. **Sync natif** — `cap sync android` et/ou `cap copy ios` + `pod install`
6. **Mise à jour versions natives** — `capacitor-set-version` pour aligner les plateformes
7. **Build & Upload par plateforme**
   - **iOS** : `xcodebuild archive` → `xcodebuild -exportArchive` (avec `destination: upload`)
   - **Android** : `./gradlew bundleRelease` → Upload AAB via Google Play API (canal internal)
8. **Commit de version** — propose de committer `src/config.json` si modifié
9. **Tag git** — propose de tagger le commit avec `vX.Y.Z`

### Mode `--no-upload`

Le même workflow, mais :
- iOS : génère l'archive et l'IPA sans uploader
- Android : génère l'AAB signé sans uploader

### Mode `--tag`

Permet de tagger la version actuelle (lue depuis `src/config.json`) après coup. Si le tag existe déjà, propose de le déplacer sur le commit actuel.

## Fichier de version

L'outil lit et écrit la version dans `src/config.json` :

```json
{
  "version": "1.5.1",
  "build": 14,
  "api_version": "v2",
  "brand_name": "Agri+"
}
```

Le script `sync-version` (`npm run sync-version`) synchronise cette version vers les projets natifs iOS et Android sans faire de build.

## Structure du build Android

Le fichier `android/app/build.gradle` doit inclure le support de `signing.properties` :

```groovy
def signingPropsFile = file("signing.properties")
def signingProps = new Properties()
if (signingPropsFile.exists()) {
    signingProps.load(new FileInputStream(signingPropsFile))
}

android {
    if (signingPropsFile.exists()) {
        signingConfigs {
            release {
                storeFile file(signingProps['storeFile'])
                storePassword signingProps['storePassword']
                keyAlias signingProps['keyAlias']
                keyPassword signingProps['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            if (signingPropsFile.exists()) {
                signingConfig signingConfigs.release
            }
        }
    }
}
```

## Licence

MIT — voir [licence.md](licence.md)
