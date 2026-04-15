use zellij_tile::prelude::*;
use std::collections::{BTreeMap, HashMap};

const SCREEN_DIR: &str = "/tmp/ccm-screens";

#[derive(Default)]
struct CcmPaneWatcher {
    watched_panes: Vec<u32>,
    last_content: HashMap<u32, String>,
    pending_flush: bool,
    event_count: u32,
}

register_plugin!(CcmPaneWatcher);

impl ZellijPlugin for CcmPaneWatcher {
    fn load(&mut self, _configuration: BTreeMap<String, String>) {
        request_permission(&[
            PermissionType::ReadApplicationState,
            PermissionType::ChangeApplicationState,
            PermissionType::MessageAndLaunchOtherPlugins,
            PermissionType::RunCommands,
            PermissionType::ReadPaneContents,
        ]);
        subscribe(&[
            EventType::PaneRenderReport,
            EventType::PaneClosed,
            EventType::Timer,
            EventType::PaneUpdate,
        ]);
    }

    fn update(&mut self, event: Event) -> bool {
        self.event_count += 1;
        match event {
            Event::PaneUpdate(_) => {
                // Debug: write event count to file on any pane update
                run_command(
                    &["bash", "-c", &format!("mkdir -p {} && echo 'event {} panes:{:?}' >> {}/debug.log", SCREEN_DIR, self.event_count, self.watched_panes, SCREEN_DIR)],
                    BTreeMap::new(),
                );
                false
            }
            Event::PaneRenderReport(pane_contents) => {
                // Debug: log that we got a render report
                let keys: Vec<String> = pane_contents.keys().map(|k| format!("{:?}", k)).collect();
                run_command(
                    &["bash", "-c", &format!("mkdir -p {} && echo 'render {} keys:{}' >> {}/debug.log", SCREEN_DIR, self.event_count, keys.join(","), SCREEN_DIR)],
                    BTreeMap::new(),
                );

                for pane_id in self.watched_panes.clone() {
                    let pid = PaneId::Terminal(pane_id);
                    if let Some(contents) = pane_contents.get(&pid) {
                        let text = contents.viewport.join("\n");
                        let changed = self.last_content.get(&pane_id)
                            .map_or(true, |prev| *prev != text);
                        if changed {
                            self.last_content.insert(pane_id, text);
                            if !self.pending_flush {
                                self.pending_flush = true;
                                set_timeout(0.5);
                            }
                        }
                    }
                }
                false
            }
            Event::Timer(_) => {
                if self.pending_flush {
                    self.pending_flush = false;
                    for (pane_id, content) in &self.last_content {
                        let path = format!("{}/pane-{}.screen", SCREEN_DIR, pane_id);
                        let safe = content.replace('\'', "'\\''");
                        run_command(
                            &["bash", "-c", &format!("mkdir -p '{}' && printf '%s' '{}' > '{}'", SCREEN_DIR, safe, path)],
                            BTreeMap::new(),
                        );
                    }
                }
                false
            }
            Event::PaneClosed(pane_id) => {
                if let PaneId::Terminal(tid) = pane_id {
                    if self.watched_panes.contains(&tid) {
                        self.watched_panes.retain(|&id| id != tid);
                        self.last_content.remove(&tid);
                        let path = format!("{}/pane-{}.screen", SCREEN_DIR, tid);
                        run_command(
                            &["bash", "-c", &format!("echo __CLOSED__ > '{}'", path)],
                            BTreeMap::new(),
                        );
                    }
                }
                false
            }
            _ => false,
        }
    }

    fn pipe(&mut self, pipe_message: PipeMessage) -> bool {
        // Debug: log pipe
        run_command(
            &["bash", "-c", &format!("mkdir -p {} && echo 'pipe: {:?}' >> {}/debug.log", SCREEN_DIR, pipe_message.payload, SCREEN_DIR)],
            BTreeMap::new(),
        );

        if let Some(payload) = &pipe_message.payload {
            let payload = payload.trim();
            if let Some(id_str) = payload.strip_prefix("watch:") {
                if let Ok(id) = id_str.parse::<u32>() {
                    if !self.watched_panes.contains(&id) {
                        self.watched_panes.push(id);
                    }
                }
            } else if let Some(id_str) = payload.strip_prefix("unwatch:") {
                if let Ok(id) = id_str.parse::<u32>() {
                    self.watched_panes.retain(|&i| i != id);
                    self.last_content.remove(&id);
                }
            }
        }
        false
    }
}
