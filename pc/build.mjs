// Prepares the Windows droid's page and icons. The drawing is the mod's own
// hooks/screen.ts + hooks/svg.ts (types stripped), exactly as desktop/build.sh does
// for the Mac app, so the three of them look the same.
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeIcons } from './icons.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(here, '..')

const scene = ['hooks/screen.ts', 'hooks/svg.ts']
  .map(p => stripTypeScriptTypes(fs.readFileSync(path.join(repo, p), 'utf8')))
  .join('\n')
  .replace(/^\s*import\b.*$/gm, '')
  .replace(/^export /gm, '')

const html = fs
  .readFileSync(path.join(repo, 'desktop/index.html'), 'utf8')
  .replace('/*SCENE*/', () => scene)
  // Nothing from outside: the page's own scripts and styles, and the beeps it synthesizes.
  .replace(
    '<meta charset="utf-8">',
    `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; media-src blob:">`,
  )
  // The PC side: hover, drag, double click and beeps (see app/pc.js).
  .replace('</body>', '<script src="beeps.js"></script>\n<script src="pc.js"></script>\n</body>')

fs.writeFileSync(path.join(here, 'app/index.html'), html)
writeIcons(here)
console.log('app/index.html, app/icons/ et build/icon.ico prêts')
