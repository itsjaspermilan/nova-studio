<script lang="ts">
  // The editor for the document on show: each kind of file opens in its own editor, and the JSON of a visual document can be shown instead.
  import Editor from "./Editor.svelte";
  import SceneEditor from "./SceneEditor.svelte";
  import SpriteEditor from "./SpriteEditor.svelte";
  import SoundEditor from "./SoundEditor.svelte";
  import ModelEditor from "./ModelEditor.svelte";
  import SongEditor from "./SongEditor.svelte";
  import TrackEditor from "./TrackEditor.svelte";
  import TimelineEditor from "./TimelineEditor.svelte";
  import WorkspaceHome from "./WorkspaceHome.svelte";
  import TilesetEditor from "./TilesetEditor.svelte";
  import ProjectSettings from "./ProjectSettings.svelte";
  import LocaleEditor from "./LocaleEditor.svelte";
  import { fileKind } from "../lib/tree";
  import { studio } from "../lib/store.svelte";

  // Scene files open visually unless the person asked for the JSON; remembered per file.
  let jsonView = $state(new Set<string>());
  const isScene = (p: string) => p.endsWith(".scene.json");
  const toggleJson = (p: string, on: boolean) => {
    const next = new Set(jsonView);
    if (on) next.add(p);
    else next.delete(p);
    jsonView = next;
  };
  const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
</script>

    {#key studio.active}
      {#if studio.tab}
        {#if studio.tab.path.toLowerCase().endsWith(".png") || (studio.tab.path.endsWith(".sprite.json") && !jsonView.has(studio.tab.path))}
          <SpriteEditor path={studio.tab.path} text={studio.tab.text} />
        {:else if /\.(wav|ogg)$/i.test(studio.tab.path) || (studio.tab.path.endsWith(".sfx.json") && !jsonView.has(studio.tab.path))}
          <SoundEditor path={studio.tab.path} text={studio.tab.text} />
        {:else if /^locales\/[^/]+\.json$/.test(studio.tab.path) && !jsonView.has(studio.tab.path)}
          <LocaleEditor path={studio.tab.path} text={studio.tab.text} />
        {:else if studio.tab.path === "nova.json" && !jsonView.has(studio.tab.path)}
          <ProjectSettings path={studio.tab.path} text={studio.tab.text} onjson={() => toggleJson(studio.tab!.path, true)} />
        {:else if studio.tab.path.endsWith(".tileset.json") && !jsonView.has(studio.tab.path)}
          <TilesetEditor path={studio.tab.path} text={studio.tab.text} onjson={() => toggleJson(studio.tab!.path, true)} />
        {:else if studio.tab.path.endsWith(".model.json") && !jsonView.has(studio.tab.path)}
          <ModelEditor path={studio.tab.path} text={studio.tab.text} onjson={() => toggleJson(studio.tab!.path, true)} />
        {:else if studio.tab.path.endsWith(".song.json") && !jsonView.has(studio.tab.path)}
          <SongEditor path={studio.tab.path} text={studio.tab.text} onjson={() => toggleJson(studio.tab!.path, true)} />
        {:else if studio.tab.path.endsWith(".track.json") && !jsonView.has(studio.tab.path)}
          <TrackEditor path={studio.tab.path} text={studio.tab.text} onjson={() => toggleJson(studio.tab!.path, true)} />
        {:else if studio.tab.path.endsWith(".anim.json") && !jsonView.has(studio.tab.path)}
          <TimelineEditor path={studio.tab.path} text={studio.tab.text} onjson={() => toggleJson(studio.tab!.path, true)} />
        {:else if studio.tab.binary}
          <div class="placeholder dim">{base(studio.tab.path)} · {fileKind(studio.tab.path)} · {studio.tab.size.toLocaleString()} bytes<br />Binary files open in their own editors (coming later).</div>
        {:else if isScene(studio.tab.path) && !jsonView.has(studio.tab.path)}
          <SceneEditor path={studio.tab.path} text={studio.tab.text} onjson={() => toggleJson(studio.tab!.path, true)} />
        {:else}
          {#if studio.tab.path === "nova.json" || isScene(studio.tab.path) || studio.tab.path.endsWith(".sprite.json") || studio.tab.path.endsWith(".sfx.json") || studio.tab.path.endsWith(".tileset.json") || studio.tab.path.endsWith(".model.json") || studio.tab.path.endsWith(".song.json")}
            <div class="viewbar"><button class="ghost" onclick={() => toggleJson(studio.tab!.path, false)}>◧ Visual editor</button></div>
          {/if}
          <Editor path={studio.tab.path} text={studio.tab.text} />
        {/if}
      {:else}
        <WorkspaceHome />
      {/if}
    {/key}

<style>
  .placeholder { height: 100%; display: grid; place-items: center; text-align: center; padding: 24px; }
</style>
