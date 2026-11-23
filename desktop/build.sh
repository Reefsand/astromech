#!/bin/zsh
# Builds Astromech.app (the floating droid) into ~/Applications, or into the folder given.
# The drawing is the mod's own hooks/svg.ts, so the app and the widget look the same.
set -euo pipefail

HERE=${0:A:h}
OUT=${1:-$HOME/Applications}
APP="$OUT/Astromech.app"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# 1. The droid's drawing: screen.ts then svg.ts, types stripped, as one plain script.
node -e '
  const fs = require("node:fs")
  const { stripTypeScriptTypes } = require("node:module")
  const [htmlPath, outPath, ...sources] = process.argv.slice(1)
  const js = sources
    .map(p => stripTypeScriptTypes(fs.readFileSync(p, "utf8")))
    .join("\n")
    .replace(/^\s*import\b.*$/gm, "")
    .replace(/^export /gm, "")
  const html = fs.readFileSync(htmlPath, "utf8").replace("/*SCENE*/", () => js)
  fs.writeFileSync(outPath, html)
' "$HERE/index.html" "$WORK/index.html" "$HERE/../hooks/screen.ts" "$HERE/../hooks/svg.ts" 2> >(grep -v -i "warning" >&2)

# 2. The program.
swiftc -O -swift-version 5 "$HERE/main.swift" "$HERE/Transcripts.swift" "$HERE/AppSessions.swift" "$HERE/Sounds.swift" "$HERE/Codex.swift" -o "$WORK/Astromech" \
  -framework Cocoa -framework Carbon -framework WebKit -framework ServiceManagement

# 3. The bundle.
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$WORK/Astromech" "$APP/Contents/MacOS/Astromech"
cp "$WORK/index.html" "$APP/Contents/Resources/index.html"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Astromech</string>
  <key>CFBundleDisplayName</key><string>Astromech</string>
  <key>CFBundleIdentifier</key><string>local.astromech.droid</string>
  <key>CFBundleExecutable</key><string>Astromech</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>CFBundleURLTypes</key>
  <array><dict>
    <key>CFBundleURLName</key><string>local.astromech.droid</string>
    <key>CFBundleURLSchemes</key><array><string>astromech</string></array>
  </dict></array>
</dict>
</plist>
PLIST
codesign --force --sign - "$APP" >/dev/null 2>&1
echo "$APP"
