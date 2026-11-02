//! Placeholder entry point. The real runtime starts with the M1 device spike
//! (see TODO.md); until then this only proves the workspace builds.

fn banner() -> String {
    format!(
        "nova-runtime {} (workspace skeleton, no runtime yet)",
        env!("CARGO_PKG_VERSION")
    )
}

fn main() {
    println!("{}", banner());
}

#[cfg(test)]
mod tests {
    use super::banner;

    #[test]
    fn banner_names_the_crate() {
        assert!(banner().starts_with("nova-runtime "));
    }
}
