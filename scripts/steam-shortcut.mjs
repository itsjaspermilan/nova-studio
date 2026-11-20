// Writes a Steam "non-Steam game" list (shortcuts.vdf, Steam's binary VDF) with one entry, for a game folder exported by
// scripts/build-linux-arm64.sh. Only for a Steam that has no shortcuts yet: it does not merge with an existing file.
//   node scripts/steam-shortcut.mjs "<name>" <exe> <start-dir> <out-file>
import { writeFileSync } from 'node:fs'
const [name, exe, dir, out] = process.argv.slice(2)
if (!out) { console.error('usage: steam-shortcut.mjs <name> <exe> <start-dir> <out-file>'); process.exit(2) }
const crc = (s) => { let c = ~0; for (const b of Buffer.from(s)) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return ~c >>> 0 }
const quoted = `"${exe}"`
const appid = (crc(quoted + name) | 0x80000000) >>> 0
const z = (s) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])])
const str = (k, v) => Buffer.concat([Buffer.from([1]), z(k), z(v)])
const int = (k, v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return Buffer.concat([Buffer.from([2]), z(k), b]) }
const entry = Buffer.concat([
  int('appid', appid), str('AppName', name), str('Exe', quoted), str('StartDir', `"${dir}"`), str('icon', ''), str('ShortcutPath', ''),
  str('LaunchOptions', ''), int('IsHidden', 0), int('AllowDesktopConfig', 1), int('AllowOverlay', 1), int('OpenVR', 0), int('Devkit', 0),
  str('DevkitGameID', ''), int('LastPlayTime', 0), Buffer.from([0]), z('tags'), Buffer.from([8]),
])
writeFileSync(out, Buffer.concat([Buffer.from([0]), z('shortcuts'), Buffer.from([0]), z('0'), entry, Buffer.from([8, 8, 8, 8])]))
console.log(`wrote ${out} (appid ${appid})`)
