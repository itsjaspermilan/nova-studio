//! The macOS menu bar. The studio's front end owns the list of menus (one list for every platform, `src/lib/menus.ts`) and sends it here
//! whenever it changes; this builds the system menu from it, with the usual application menu in front, and sends each click back
//! as a "menu-command" event naming the command. On other systems the front end draws its own menu bar and this does nothing.

use serde::Deserialize;
use tauri::AppHandle;

#[derive(Debug, Deserialize)]
pub struct ItemSpec {
    pub id: Option<String>,
    pub title: Option<String>,
    pub accelerator: Option<String>,
    pub enabled: bool,
    pub native: Option<String>,
    pub separator: bool,
}

#[derive(Debug, Deserialize)]
pub struct MenuSpec {
    pub title: String,
    pub items: Vec<ItemSpec>,
}

#[tauri::command]
pub fn set_menu(app: AppHandle, menus: Vec<MenuSpec>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        build(&app, &menus).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, menus);
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn build(app: &AppHandle, menus: &[MenuSpec]) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, Submenu};

    let root = Menu::new(app)?;
    let name = app.package_info().name.clone();
    let app_menu = Submenu::new(app, "Nova", true)?;
    app_menu.append(&PredefinedMenuItem::about(app, Some(&format!("About {name}")), None)?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&PredefinedMenuItem::services(app, None)?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&PredefinedMenuItem::hide(app, None)?)?;
    app_menu.append(&PredefinedMenuItem::hide_others(app, None)?)?;
    app_menu.append(&PredefinedMenuItem::show_all(app, None)?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&PredefinedMenuItem::quit(app, None)?)?;
    root.append(&app_menu)?;

    for menu in menus {
        let sub = Submenu::new(app, &menu.title, true)?;
        for item in &menu.items {
            if item.separator {
                sub.append(&PredefinedMenuItem::separator(app)?)?;
                continue;
            }
            // text editing and the window buttons are the system's own items: they act on the focused control without the page's help
            match item.native.as_deref() {
                Some("cut") => sub.append(&PredefinedMenuItem::cut(app, None)?)?,
                Some("copy") => sub.append(&PredefinedMenuItem::copy(app, None)?)?,
                Some("paste") => sub.append(&PredefinedMenuItem::paste(app, None)?)?,
                Some("selectAll") => sub.append(&PredefinedMenuItem::select_all(app, None)?)?,
                Some("minimize") => sub.append(&PredefinedMenuItem::minimize(app, None)?)?,
                Some("maximize") => sub.append(&PredefinedMenuItem::maximize(app, None)?)?,
                _ => {
                    let (Some(id), Some(title)) = (&item.id, &item.title) else { continue };
                    let mut b = MenuItemBuilder::with_id(id.clone(), title).enabled(item.enabled);
                    if let Some(acc) = &item.accelerator {
                        b = b.accelerator(acc);
                    }
                    sub.append(&b.build(app)?)?;
                }
            }
        }
        root.append(&sub)?;
    }
    app.set_menu(root)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_menu_list_from_the_front_end_reads() {
        let json = r#"[{"title":"File","items":[
            {"id":"file.save","title":"Save","accelerator":"CmdOrCtrl+S","enabled":true,"native":null,"separator":false},
            {"id":null,"title":null,"accelerator":null,"enabled":true,"native":null,"separator":true},
            {"id":null,"title":null,"accelerator":null,"enabled":true,"native":"minimize","separator":false}]}]"#;
        let menus: Vec<MenuSpec> = serde_json::from_str(json).unwrap();
        assert_eq!(menus[0].items.len(), 3);
        assert_eq!(menus[0].items[0].accelerator.as_deref(), Some("CmdOrCtrl+S"));
        assert!(menus[0].items[1].separator);
        assert_eq!(menus[0].items[2].native.as_deref(), Some("minimize"));
    }
}
