// Writes a Steam "non-Steam game" list (shortcuts.vdf, Steam's binary VDF) with one entry, for a game folder exported by
// scripts/build-linux-arm64.sh. Only for a Steam that has no shortcuts yet: it does not merge with an existing file
// (steam-shortcut-add.mjs adds to one, and reads this file back exactly: studio/mcp/steam-shortcut.test.ts).
//   node scripts/steam-shortcut.mjs "<name>" <exe> <start-dir> <out-file>
// The entry has the fields, in the order, that Steam itself writes for a non-Steam game, and the file ends as Steam's do: the
// tags map, the entry, the list and the file each closed by one 0x08.
import { writeFileSync } from 'node:fs'
const [name, exe, dir, out] = process.argv.slice(2)
if (!out) { console.error('usage: steam-shortcut.mjs <name> <exe> <start-dir> <out-file>'); process.exit(2) }
const crc = (s) => { let c = ~0; for (const b of Buffer.from(s)) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return ~c >>> 0 }
const quoted = `"${exe}"`
const appid = (crc(quoted + name) | 0x80000000) >>> 0
const END = Buffer.from([8])
const z = (s) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])])
const str = (k, v) => Buffer.concat([Buffer.from([1]), z(k), z(v)])
const int = (k, v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return Buffer.concat([Buffer.from([2]), z(k), b]) }
const map = (k, ...items) => Buffer.concat([Buffer.from([0]), z(k), ...items, END])
const entry = map('0',
  int('appid', appid), str('AppName', name), str('Exe', quoted), str('StartDir', `"${dir}"`), str('icon', ''), str('ShortcutPath', ''),
  str('LaunchOptions', ''), int('IsHidden', 0), int('AllowDesktopConfig', 1), int('AllowOverlay', 1), int('OpenVR', 0), int('Devkit', 0),
  str('DevkitGameID', ''), int('DevkitOverrideAppID', 0), int('LastPlayTime', 0), str('FlatpakAppID', ''), map('tags'),
)
writeFileSync(out, Buffer.concat([map('shortcuts', entry), END]))
console.log(`wrote ${out} (appid ${appid})`)
