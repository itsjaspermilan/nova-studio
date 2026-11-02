//! `.npk`: a project packed into one file, for shipping inside an APK (or next to a desktop
//! build). The runtime reads it through the same `Vfs` as a folder, so a packed game behaves
//! exactly like `nova run <folder>` minus hot reload.
//!
//! Layout (all integers little-endian): magic `NPK1`, `u32` file count, then for each file
//! `u16` path length, the UTF-8 path, `u64` offset into the data block, `u64` size; then the data
//! block. Paths use the same rules as everywhere else (relative, forward slashes, no `..`).

use std::collections::BTreeMap;
use std::sync::Arc;

use crate::vfs::{MAX_FILE_BYTES, MAX_FILES, Vfs, VfsEntry, normalize};

const MAGIC: &[u8; 4] = b"NPK1";

/// Reads every project file through `source` and packs them. The manifest must be present.
pub fn pack(source: &dyn Vfs) -> Result<Vec<u8>, String> {
    let entries = source.list()?;
    if !entries.iter().any(|e| e.path == crate::project::MANIFEST) {
        return Err(format!(
            "not a Nova project: no {} found",
            crate::project::MANIFEST
        ));
    }
    if entries.len() > MAX_FILES {
        return Err(format!("project has more than {MAX_FILES} files"));
    }
    let mut table = Vec::new();
    let mut data = Vec::new();
    for VfsEntry { path, .. } in &entries {
        let bytes = source.read(path)?;
        if path.len() > u16::MAX as usize {
            return Err(format!("'{path}' has too long a name"));
        }
        table.extend_from_slice(&(path.len() as u16).to_le_bytes());
        table.extend_from_slice(path.as_bytes());
        table.extend_from_slice(&(data.len() as u64).to_le_bytes());
        table.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
        data.extend_from_slice(&bytes);
    }
    let mut out = Vec::with_capacity(8 + table.len() + data.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&(entries.len() as u32).to_le_bytes());
    out.extend_from_slice(&table);
    out.extend_from_slice(&data);
    Ok(out)
}

pub struct PakVfs {
    bytes: Arc<Vec<u8>>,
    data_start: usize,
    files: BTreeMap<String, (usize, usize)>, // path -> (offset in data block, size)
}

struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self
            .at
            .checked_add(n)
            .filter(|&e| e <= self.bytes.len())
            .ok_or("the project file is truncated")?;
        let slice = &self.bytes[self.at..end];
        self.at = end;
        Ok(slice)
    }
    fn u16(&mut self) -> Result<u16, String> {
        Ok(u16::from_le_bytes(
            self.take(2)?.try_into().expect("two bytes"),
        ))
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(
            self.take(4)?.try_into().expect("four bytes"),
        ))
    }
    fn u64(&mut self) -> Result<u64, String> {
        Ok(u64::from_le_bytes(
            self.take(8)?.try_into().expect("eight bytes"),
        ))
    }
}

impl PakVfs {
    pub fn new(bytes: Arc<Vec<u8>>) -> Result<Self, String> {
        let mut cur = Cursor {
            bytes: &bytes,
            at: 0,
        };
        if cur
            .take(4)
            .map_err(|_| "not a Nova project file (too short)".to_string())?
            != MAGIC
        {
            return Err("not a Nova project file (wrong header)".into());
        }
        let count = cur.u32()? as usize;
        if count > MAX_FILES {
            return Err(format!(
                "the project file claims {count} files; the limit is {MAX_FILES}"
            ));
        }
        let mut raw = Vec::with_capacity(count);
        for _ in 0..count {
            let len = cur.u16()? as usize;
            let path = std::str::from_utf8(cur.take(len)?)
                .map_err(|_| "a file name in the project file is not UTF-8")?
                .to_string();
            let offset = cur.u64()?;
            let size = cur.u64()?;
            raw.push((path, offset, size));
        }
        let data_start = cur.at;
        let data_len = (bytes.len() - data_start) as u64;
        let mut files = BTreeMap::new();
        for (path, offset, size) in raw {
            let canonical =
                normalize(&path).map_err(|e| format!("bad file name in the project file: {e}"))?;
            if canonical != path {
                return Err(format!(
                    "bad file name in the project file: '{path}' is not in canonical form"
                ));
            }
            if size > MAX_FILE_BYTES {
                return Err(format!(
                    "'{path}' is bigger than the {} MiB file limit",
                    MAX_FILE_BYTES >> 20
                ));
            }
            if offset.checked_add(size).is_none_or(|end| end > data_len) {
                return Err(format!(
                    "'{path}' points outside the project file (it is damaged)"
                ));
            }
            if files
                .insert(path.clone(), (offset as usize, size as usize))
                .is_some()
            {
                return Err(format!("'{path}' appears twice in the project file"));
            }
        }
        Ok(PakVfs {
            bytes,
            data_start,
            files,
        })
    }
}

impl Vfs for PakVfs {
    fn read(&self, path: &str) -> Result<Vec<u8>, String> {
        let path = normalize(path)?;
        let (offset, size) = *self
            .files
            .get(&path)
            .ok_or_else(|| format!("file '{path}' not found"))?;
        let start = self.data_start + offset;
        Ok(self.bytes[start..start + size].to_vec())
    }

    fn list(&self) -> Result<Vec<VfsEntry>, String> {
        Ok(self
            .files
            .iter()
            .map(|(p, (_, s))| VfsEntry {
                path: p.clone(),
                size: *s as u64,
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::MemVfs;

    fn sample() -> MemVfs {
        MemVfs::new([
            ("nova.json", br#"{"format":1,"name":"P"}"#.to_vec()),
            ("main.lua", b"print('hi')".to_vec()),
            ("sprites/a.png", vec![1, 2, 3, 4, 5]),
            ("empty.txt", vec![]),
        ])
    }

    #[test]
    fn a_packed_project_reads_back_identically() {
        let bytes = pack(&sample()).unwrap();
        let vfs = PakVfs::new(Arc::new(bytes)).unwrap();
        let listed: Vec<_> = vfs
            .list()
            .unwrap()
            .into_iter()
            .map(|e| (e.path, e.size))
            .collect();
        assert_eq!(
            listed,
            [
                ("empty.txt".to_string(), 0),
                ("main.lua".into(), 11),
                ("nova.json".into(), 23),
                ("sprites/a.png".into(), 5)
            ]
        );
        assert_eq!(vfs.read("./sprites/a.png").unwrap(), [1, 2, 3, 4, 5]);
        assert_eq!(vfs.read("empty.txt").unwrap(), Vec::<u8>::new());
        assert!(vfs.read("nope").unwrap_err().contains("not found"));
        assert!(vfs.read("../x").unwrap_err().contains("leaves the project"));
        assert!(
            crate::project::Project::open(&vfs).is_ok(),
            "a packed project opens like a folder"
        );
    }

    #[test]
    fn packing_requires_a_manifest() {
        let e = pack(&MemVfs::new([("main.lua", b"x".to_vec())])).unwrap_err();
        assert!(e.contains("no nova.json"), "{e}");
    }

    fn rebuild(entries: &[(&str, u64, u64)], data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&(entries.len() as u32).to_le_bytes());
        for (path, offset, size) in entries {
            out.extend_from_slice(&(path.len() as u16).to_le_bytes());
            out.extend_from_slice(path.as_bytes());
            out.extend_from_slice(&offset.to_le_bytes());
            out.extend_from_slice(&size.to_le_bytes());
        }
        out.extend_from_slice(data);
        out
    }

    #[test]
    fn damaged_or_hostile_files_are_rejected_without_panicking() {
        let ok = |b: Vec<u8>| PakVfs::new(Arc::new(b));
        assert!(ok(vec![]).err().unwrap().contains("too short"));
        assert!(
            ok(b"NOPE\0\0\0\0".to_vec())
                .err()
                .unwrap()
                .contains("wrong header")
        );
        assert!(ok(b"NPK1".to_vec()).err().unwrap().contains("truncated"));
        // Truncate a valid file at every length: never a panic, always an error or a valid shorter read.
        let good = pack(&sample()).unwrap();
        for cut in 0..good.len() {
            let _ = ok(good[..cut].to_vec());
        }
        assert!(
            ok(rebuild(&[("a", 0, 10)], b"short"))
                .err()
                .unwrap()
                .contains("outside the project file")
        );
        assert!(
            ok(rebuild(&[("a", u64::MAX, 2)], b"xx"))
                .err()
                .unwrap()
                .contains("outside the project file")
        );
        assert!(
            ok(rebuild(&[("a", 0, 1), ("a", 0, 1)], b"x"))
                .err()
                .unwrap()
                .contains("appears twice")
        );
        assert!(
            ok(rebuild(&[("../evil", 0, 1)], b"x"))
                .err()
                .unwrap()
                .contains("leaves the project")
        );
        assert!(
            ok(rebuild(&[("/abs", 0, 1)], b"x"))
                .err()
                .unwrap()
                .contains("absolute")
        );
        assert!(
            ok(rebuild(&[("a//b", 0, 1)], b"x"))
                .err()
                .unwrap()
                .contains("canonical")
        );
        assert!(
            ok(rebuild(&[("a", 0, MAX_FILE_BYTES + 1)], b"x"))
                .err()
                .unwrap()
                .contains("file limit")
        );
    }
}
