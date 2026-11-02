//! Tile grids. The tile data lives in native code, so drawing a big map costs one
//! culled pass per frame instead of thousands of calls from Lua.
//!
//! A tile is an index into the tileset image (row-major, from 0); `-1` is empty.

pub const MAX_TILES: u64 = 1_000_000;
pub const EMPTY: i16 = -1;

#[derive(Clone, Debug)]
pub struct TileMap {
    /// Project path of the tileset PNG.
    pub image: String,
    pub tile_w: u32,
    pub tile_h: u32,
    /// Tiles per row in the tileset image.
    pub columns: u32,
    pub tile_count: u32,
    pub width: u32,
    pub height: u32,
    pub tiles: Vec<i16>,
}

impl TileMap {
    /// `image_size` is the tileset image's pixel size; `rows` is the map, top row first.
    pub fn new(
        image: &str,
        tile_w: u32,
        tile_h: u32,
        image_size: (u32, u32),
        rows: Vec<Vec<i64>>,
    ) -> Result<TileMap, String> {
        if tile_w == 0 || tile_h == 0 {
            return Err("tile_width and tile_height must be greater than 0".into());
        }
        if tile_w > image_size.0 || tile_h > image_size.1 {
            return Err(format!(
                "tiles of {tile_w}x{tile_h} do not fit in the {}x{} tileset '{image}'",
                image_size.0, image_size.1
            ));
        }
        let columns = image_size.0 / tile_w;
        let tile_count = columns * (image_size.1 / tile_h);
        let height = rows.len() as u32;
        let width = rows.first().map_or(0, |r| r.len()) as u32;
        if width == 0 || height == 0 {
            return Err("the map has no tiles; give it at least one row with one tile".into());
        }
        if width as u64 * height as u64 > MAX_TILES {
            return Err(format!(
                "the map is {width}x{height} tiles; the limit is {MAX_TILES} tiles in total"
            ));
        }
        let mut tiles = Vec::with_capacity((width * height) as usize);
        for (r, row) in rows.iter().enumerate() {
            if row.len() as u32 != width {
                return Err(format!(
                    "row {r} has {} tiles but row 0 has {width}; every row must be the same length",
                    row.len()
                ));
            }
            for (c, &tile) in row.iter().enumerate() {
                tiles.push(
                    Self::check(tile, tile_count)
                        .map_err(|e| format!("tile at column {c}, row {r}: {e}"))?,
                );
            }
        }
        Ok(TileMap {
            image: image.to_string(),
            tile_w,
            tile_h,
            columns,
            tile_count,
            width,
            height,
            tiles,
        })
    }

    fn check(tile: i64, tile_count: u32) -> Result<i16, String> {
        if tile == EMPTY as i64 {
            return Ok(EMPTY);
        }
        if tile < 0 || tile >= tile_count as i64 {
            return Err(format!(
                "{tile} is not a tile of this tileset (use -1 for empty, or 0 to {})",
                tile_count - 1
            ));
        }
        Ok(tile as i16)
    }

    pub fn get(&self, col: i64, row: i64) -> i16 {
        if col < 0 || row < 0 || col >= self.width as i64 || row >= self.height as i64 {
            return EMPTY;
        }
        self.tiles[(row as u32 * self.width + col as u32) as usize]
    }

    pub fn set(&mut self, col: i64, row: i64, tile: i64) -> Result<(), String> {
        if col < 0 || row < 0 || col >= self.width as i64 || row >= self.height as i64 {
            return Err(format!(
                "cell ({col}, {row}) is outside the {}x{} map",
                self.width, self.height
            ));
        }
        let tile = Self::check(tile, self.tile_count)?;
        self.tiles[(row as u32 * self.width + col as u32) as usize] = tile;
        Ok(())
    }

    /// The inclusive range `(first_col, last_col, first_row, last_row)` of cells that touch
    /// a view of `view` logical units when the map's top-left corner is at `(ox, oy)` and
    /// tiles are drawn at `scale`. None when nothing is visible.
    pub fn visible(
        &self,
        ox: f32,
        oy: f32,
        scale: f32,
        view: [f32; 2],
    ) -> Option<(u32, u32, u32, u32)> {
        let (tw, th) = (self.tile_w as f32 * scale, self.tile_h as f32 * scale);
        let first_col = (-ox / tw).floor().max(0.0);
        let first_row = (-oy / th).floor().max(0.0);
        let last_col = ((view[0] - ox) / tw).floor().min(self.width as f32 - 1.0);
        let last_row = ((view[1] - oy) / th).floor().min(self.height as f32 - 1.0);
        if first_col > last_col || first_row > last_row {
            return None;
        }
        Some((
            first_col as u32,
            last_col as u32,
            first_row as u32,
            last_row as u32,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(rows: Vec<Vec<i64>>) -> Result<TileMap, String> {
        TileMap::new("sprites/tiles.png", 16, 16, (64, 32), rows)
    }

    #[test]
    fn builds_a_grid_and_reads_and_writes_cells() {
        let mut m = map(vec![vec![0, 1, -1], vec![7, 2, 3]]).unwrap();
        assert_eq!((m.width, m.height, m.columns, m.tile_count), (3, 2, 4, 8));
        assert_eq!(m.get(1, 0), 1);
        assert_eq!(m.get(0, 1), 7);
        assert_eq!(m.get(2, 0), EMPTY);
        assert_eq!(m.get(-1, 0), EMPTY, "outside the map reads as empty");
        assert_eq!(m.get(3, 0), EMPTY);
        m.set(2, 0, 5).unwrap();
        assert_eq!(m.get(2, 0), 5);
        m.set(2, 0, -1).unwrap();
        assert_eq!(m.get(2, 0), EMPTY);
    }

    #[test]
    fn bad_maps_and_writes_are_explained() {
        assert!(map(vec![]).unwrap_err().contains("no tiles"));
        assert!(map(vec![vec![]]).unwrap_err().contains("no tiles"));
        assert!(
            map(vec![vec![0, 1], vec![0]])
                .unwrap_err()
                .contains("row 1 has 1 tiles but row 0 has 2")
        );
        assert!(
            map(vec![vec![0, 99]])
                .unwrap_err()
                .contains("column 1, row 0: 99 is not a tile")
        );
        assert!(
            map(vec![vec![-2]])
                .unwrap_err()
                .contains("-2 is not a tile")
        );
        assert!(
            TileMap::new("t.png", 0, 16, (64, 32), vec![vec![0]])
                .unwrap_err()
                .contains("greater than 0")
        );
        assert!(
            TileMap::new("t.png", 100, 16, (64, 32), vec![vec![0]])
                .unwrap_err()
                .contains("do not fit")
        );
        let mut m = map(vec![vec![0]]).unwrap();
        assert!(m.set(1, 0, 0).unwrap_err().contains("outside the 1x1 map"));
        assert!(
            m.set(0, 0, 8)
                .unwrap_err()
                .contains("not a tile of this tileset")
        );
    }

    #[test]
    fn visible_range_is_clamped_to_the_map_and_the_view() {
        let rows = vec![vec![0; 100]; 50];
        let m = map(rows).unwrap();
        // 960x540 view, 16 px tiles at scale 1, map at the origin: 60 columns and 34 rows touch the view.
        assert_eq!(
            m.visible(0.0, 0.0, 1.0, [960.0, 540.0]),
            Some((0, 60, 0, 33))
        );
        // Scrolled: the map's corner is 100 px left of and 20 px above the view.
        assert_eq!(
            m.visible(-100.0, -20.0, 1.0, [960.0, 540.0]),
            Some((6, 66, 1, 35))
        );
        // Fully off screen on either side.
        assert_eq!(m.visible(1000.0, 0.0, 1.0, [960.0, 540.0]), None);
        assert_eq!(m.visible(-5000.0, 0.0, 1.0, [960.0, 540.0]), None);
        // Past the end of a small map.
        let small = map(vec![vec![0; 3]; 2]).unwrap();
        assert_eq!(
            small.visible(0.0, 0.0, 2.0, [960.0, 540.0]),
            Some((0, 2, 0, 1))
        );
    }
}
