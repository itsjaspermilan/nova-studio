// Adds one "non-Steam game" to an existing Steam list (shortcuts.vdf, Steam's binary VDF), copying the settings of an
// entry already in it (launch options and so on) so the new game starts the same way. Leaves the other entries as they are.
//   node scripts/steam-shortcut-add.mjs <in-file> <out-file> "<name>" <exe> <start-dir> ["<name of the entry to copy>"]
// Steam must be restarted to see the change. Keep a copy of the old file. For a Steam with no list yet: steam-shortcut.mjs.
import { readFileSync, writeFileSync } from 'node:fs'
const [inFile, outFile, name, exe, dir, like] = process.argv.slice(2)
if (!dir) { console.error('usage: steam-shortcut-add.mjs <in> <out> "<name>" <exe> <start-dir> ["<entry to copy>"]'); process.exit(2) }
const buf = readFileSync(inFile)
let p = 0
const cstr = () => { const e = buf.indexOf(0, p); const s = buf.toString('utf8', p, e); p = e + 1; return s }
// A map is a list of [type, key, value] so order and key spelling are kept exactly.
const map = () => { const out = []; for (;;) { const t = buf[p++]; if (t === 8) return out; const k = cstr()
  if (t === 0) out.push([t, k, map()]); else if (t === 1) out.push([t, k, cstr()]); else if (t === 2) { out.push([t, k, buf.readUInt32LE(p)]); p += 4 }
  else throw new Error(`unknown type ${t} at ${p - 1}`) } }
const root = map()
const z = (s) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])])
const ser = (m) => Buffer.concat([...m.map(([t, k, v]) => { const head = Buffer.concat([Buffer.from([t]), z(k)])
  if (t === 0) return Buffer.concat([head, ser(v)]); if (t === 1) return Buffer.concat([head, z(v)])
  const b = Buffer.alloc(4); b.writeUInt32LE(v); return Buffer.concat([head, b]) }), Buffer.from([8])])
if (p !== buf.length || !ser(root).equals(buf)) throw new Error('could not read this file exactly; nothing written')
const list = root.find(([, k]) => k.toLowerCase() === 'shortcuts')[2]
const field = (e, k) => e[2].find(([, key]) => key.toLowerCase() === k)
if (list.some((e) => field(e, 'appname')?.[2] === name)) { console.log(`"${name}" is already in the list; nothing written`); process.exit(0) }
const model = like ? list.find((e) => field(e, 'appname')?.[2] === like) : list[0]
if (!model) throw new Error(`no entry named "${like}" to copy`)
const crc = (s) => { let c = ~0; for (const b of Buffer.from(s)) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return ~c >>> 0 }
const quoted = `"${exe}"`
const entry = [0, String(list.length), structuredClone(model[2])]
const set = (k, v) => { const f = field(entry, k); if (f) f[2] = v }
set('appid', (crc(quoted + name) | 0x80000000) >>> 0); set('appname', name); set('exe', quoted); set('startdir', `"${dir}"`)
set('icon', ''); set('lastplaytime', 0)
list.push(entry)
writeFileSync(outFile, ser(root))
console.log(`wrote ${outFile}: ${list.length} entries, added "${name}" copying "${field(model, 'appname')[2]}"`)
