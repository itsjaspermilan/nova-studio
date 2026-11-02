// The help window's lessons. Code in a lesson lives in `tutorials/*.lua`, and the runtime's tests play every one of those
// files on top of the Starter template (crates/nova-runtime/tests/tutorials.rs), so what a lesson shows really works.

const files = import.meta.glob("./tutorials/*.lua", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export interface Snippet {
  id: string;
  /// Where the code goes in a project.
  path: string;
  code: string;
}

/// `-- file: <path>` on the first line says where the code goes; the rest is what is shown.
export function parseSnippet(id: string, text: string): Snippet {
  const [first = "", ...rest] = text.split("\n");
  const m = /^--\s*file:\s*(\S+)\s*$/.exec(first);
  if (!m) throw new Error(`lesson code '${id}' must start with "-- file: <path>"`);
  return { id, path: m[1]!, code: rest.join("\n").replace(/^\n+/, "").trimEnd() + "\n" };
}

export const snippets: Record<string, Snippet> = Object.fromEntries(
  Object.entries(files).map(([path, text]) => {
    const id = path.slice(path.lastIndexOf("/") + 1).replace(/\.lua$/, "");
    return [id, parseSnippet(id, text)];
  }),
);

export interface Step {
  title: string;
  /// Lesson markup (see markup.ts).
  body: string;
  /// A code file from `tutorials/` shown under the text, with a button to add it to the project.
  snippet?: string;
}

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  /// What to have before starting.
  needs: string;
  steps: Step[];
}

export const lessons: Lesson[] = [
  {
    id: "first-game",
    title: "Your first game: collect the coins",
    summary: "Make a project, change how the player feels, and add coins and a score.",
    minutes: 10,
    needs: "Nothing: start from the Starter template.",
    steps: [
      {
        title: "Make a project and press Play",
        body: `
In the project hub choose **New project**, pick the **Starter** template and press **Create project**. The studio opens it for you.

Press **▶ Play** at the top right (or ⌘↩). A game window opens. Move with **A** and **D**, jump with **Space**. Close that window, or press **■ Stop**, when you are done.

> Your project is a normal folder of files. The file list on the left shows them, and you can open it in any other program too.
`,
      },
      {
        title: "Change how the player feels",
        body: `
Open \`entities/player.lua\` from the file list. Near the top you will see \`speed = 220\`. Change it to \`speed = 320\` and press ⌘S to save.

Press **▶ Play** again. The player is faster. If the game is already running when you save, it reloads by itself, so you can tweak numbers and watch.

Try \`jump_speed\` and \`gravity\` too. Higher gravity makes jumps shorter and snappier.
`,
      },
      {
        title: "A score counter",
        body: `
An **entity** is one kind of thing in your game. This one only shows text: how many coins you have.

Press **Add to my project** to make the file \`entities/score.lua\`.

> \`screen = true\` means it draws on the screen like a HUD, not out in the world. Other entities find it by its tag, \`"score"\`.
`,
        snippet: "01-first-game__1-score",
      },
      {
        title: "A coin",
        body: `
Now the coin. It has a small box (its \`hitbox\`), draws a yellow square, and when the player touches it, it tells the score to add a point and removes itself.

Add it to your project.

> The method name \`on_collide_player\` is how it works: when something tagged \`player\` overlaps this entity, Nova calls it.
`,
        snippet: "01-first-game__2-coin",
      },
      {
        title: "Put coins in the level",
        body: `
Last, the scene makes the score and six coins when the level starts. This replaces \`scenes/title.lua\`.

Press **Add to my project** (it will ask before replacing), then **▶ Play**. Jump to grab the coins. The coin counter goes up.

Drag around the numbers: more coins, a different height, a bigger gap.
`,
        snippet: "01-first-game__3-scene",
      },
      {
        title: "Where to go from here",
        body: `
- Draw your own player and coins in the next lesson.
- Give the coins a sound.
- Press **Check now** in the Problems panel any time something looks wrong. It tells you the file and line.
`,
      },
    ],
  },
  {
    id: "sprite",
    title: "Draw a character and animate it",
    summary: "Use the sprite editor to make frames, name an animation and play it in your game.",
    minutes: 10,
    needs: "The project from lesson 1 (or any project with the Starter template).",
    steps: [
      {
        title: "Make a new sprite",
        body: `
In the file list header press **◩** (New sprite). Type a name such as \`hero\`, choose a size (32×32 is a good start) and press **Create**. The sprite editor opens.

You will see a big grid. The tools are down the left side: pencil, eraser, fill, line, rectangle, ellipse, a colour picker, and undo.
`,
      },
      {
        title: "Draw the first frame",
        body: `
Pick a colour from the palette on the right and draw with the **pencil** (shortcut **B**). Press **E** for the eraser and **G** to fill an area.

A few helpers: turn on **↔** to mirror everything you draw left to right (great for faces and bodies), press **[** and **]** to change the brush size, and scroll or use − / ＋ to zoom.

> Made a mistake? ⌘Z undoes it.
`,
      },
      {
        title: "Add a second frame",
        body: `
Press **＋ Frame** under the canvas. The new frame appears in the strip. The faint picture behind it is the **onion skin**: your previous frame, so you can see how far to move things.

Draw a slightly different pose: an arm moved, a foot lifted. Click the frames in the strip to go back and forth.
`,
      },
      {
        title: "Name an animation",
        body: `
In the sidebar find **Animations** and press **＋ Animation from this frame**. Set **From 1** and **To 2** so it covers both frames, and name it \`run\`.

Press **▶ Play** in the Preview box to watch it. Frames last 100 ms by default; change **Duration** under the strip to speed it up or slow it down.

Press ⌘S to save.
`,
      },
      {
        title: "Use it in the game",
        body: `
Open \`entities/player.lua\` and change \`sprite = "player"\` to \`sprite = "hero"\` (use the name you gave).

The starter player asks for animations named **idle**, **run** and **jump** with \`self:play("run")\`. Either name your animations that, or change the names in the file to match yours.

Press **▶ Play**. Your character is in the game.

> Sprites are flat pictures to the game. If you used layers, the studio keeps them in a hidden file next to your sprite and the game only sees the finished picture.
`,
      },
    ],
  },
  {
    id: "sound",
    title: "Make a sound effect",
    summary: "Generate a coin sound and play it when the player picks a coin up.",
    minutes: 6,
    needs: "The coins from lesson 1.",
    steps: [
      {
        title: "Create the sound",
        body: `
Press **♪** (New sound effect) in the file list header, type \`coin\`, and press **Create**. The studio makes a bright "coin" blip for you.

Press **▶ Play** (or Space) to hear it. Try the **Start from** buttons for other kinds of sounds, **🎲 Random** for surprises, and **Mutate** for small changes to the one you have.
`,
      },
      {
        title: "Shape it",
        body: `
The sliders change the sound: **Pitch** is how high it is, **Slide** makes it rise or fall, and **Decay** is how long it takes to fade. Let go of a slider and it plays again so you can hear the change.

Press ⌘S to save. The studio writes \`sounds/coin.wav\` for the game and keeps your settings in \`sounds/coin.sfx.json\` so you can come back and tweak.
`,
      },
      {
        title: "Play it from the coin",
        body: `
Add this version of the coin to your project. It is the same as before with one new line, \`nova.sound.play("coin")\`.

Press **▶ Play** and grab a coin.

> The name in quotes is the file name without \`.wav\`. A sound called \`jump\` would be \`nova.sound.play("jump")\`.
`,
        snippet: "03-sound__1-coin",
      },
      {
        title: "Music",
        body: `
Press **♫** (New song) for a small music maker. Click in the grid to place notes, drag them to move them, and press Space to hear it loop. Songs save as \`music/<name>.wav\`; play one with \`nova.music.play("name")\`.
`,
      },
    ],
  },
  {
    id: "level",
    title: "A level bigger than the screen",
    summary: "Make the world wider than the window and have the camera follow the player.",
    minutes: 8,
    needs: "The Starter template (lesson 1 helps).",
    steps: [
      {
        title: "Open the scene in the editor",
        body: `
Open \`scenes/title.scene.json\` from the file list. It opens in the **scene editor**: a picture of your level with the things in it. Drag the hero to move him, scroll to zoom, drag empty space to look around.

The right side lists what you have selected. With nothing selected you can change the **Background** colour and the **Width** and **Height** of the whole level.
`,
      },
      {
        title: "Make the level wider",
        body: `
With nothing selected, set **Width** to \`1920\`. The level is now twice as wide as the window.

Click the hero and look at the **Name** box: it says \`hero\`. A name is how your code finds an object: the scene can use it as \`self.hero\`.

Press ⌘S.
`,
      },
      {
        title: "Make the camera follow",
        body: `
This scene tells the camera the level's size and which object to follow. It replaces \`scenes/title.lua\` and spawns twelve coins along the way.

Add it, press **▶ Play**, and run right: the camera follows and stops at the level's edge.
`,
        snippet: "04-level__1-scene",
      },
      {
        title: "Paint a floor",
        body: `
Back in the scene editor choose **New tile map…** in the left list, pick a tile image (a PNG made of equal squares) and press **Create**. Choose **Tiles** in the top bar, pick a tile in the picture on the right and click on the level to paint. **Make this tile solid** marks tiles that things cannot walk through.

> Don't have a tile image? Make one in the sprite editor: a new sprite of 16×16 per tile is easy to start with, and ◩ makes the PNG for you.
`,
      },
    ],
  },
  {
    id: "model",
    title: "Make a 3D model and animate it",
    summary: "Build a model from blocks, give it a spinning animation and show it in a game.",
    minutes: 12,
    needs: "Nothing. This starts a new project, so it will not touch your other games.",
    steps: [
      {
        title: "Make a model",
        body: `
Press **◆** (New 3D model) in the file list header, type \`robot\`, and press **Create**. The model editor opens with one cube.

Drag in the picture to turn the view, right-drag to move it, and scroll to zoom. Click the cube to select it. On the right you can change its position, **Size**, and a colour for each face.
`,
      },
      {
        title: "Add parts",
        body: `
A model is made of **parts**, and each part holds cubes. Parts move as a whole, so put things that will move together in one part.

Press **＋ Part** (a part inside the selected one, here the body) and then **＋ Cube** to give it a cube. Make a small cube for a head: set its size to about \`8, 8, 8\` and its position up high. Rename the part to \`head\` in the Part panel.

> The arrow keys move the selected part or cube, PageUp and PageDown move it up and down, and ⌘D copies it.
`,
      },
      {
        title: "Animate it",
        body: `
Press **Animate** in the top bar. The studio makes an animation for you. Rename it \`spin\` and set the **Length** to \`1\`.

Click the **body** part. The right panel now shows its **Pose**. At time 0 press **◆ Key rotation** to save the starting pose.

Now move the time bar to \`0.33\` (drag it, or click it and use the arrow keys: each press moves it 0.01) and change the second **Rotation** number (Y) to \`120\`. At \`0.66\` set \`240\`, and at \`1\` set \`360\`. Each change puts a ◆ key on the time bar.

Press **▶** under the picture to watch it turn.

> Rotations take the short way round between two keys, so keep them less than about 150° apart. That is why we set four keys for one full turn.
`,
      },
      {
        title: "Show it in a game",
        body: `
Press ⌘S, which saves the model and writes \`models/robot.glb\` for the game. This small program shows it with a camera and a light. It replaces \`main.lua\`, so use a fresh project for this lesson.

Add it, then press **▶ Play**. Your robot spins.

> In a bigger game you would give an entity \`model = "robot"\` and call \`self:play_clip("spin")\`.
`,
        snippet: "05-model__1-main",
      },
    ],
  },
];

export interface Tip {
  keys: string;
  what: string;
}

export const shortcuts: { area: string; tips: Tip[] }[] = [
  {
    area: "Anywhere",
    tips: [
      { keys: "⌘S", what: "Save the open file" },
      { keys: "⌘↩", what: "Save everything and Play (again to Stop)" },
      { keys: "⌘Z / ⇧⌘Z", what: "Undo / redo in the picture, sound, model, scene and song editors" },
    ],
  },
  {
    area: "Code editor",
    tips: [
      { keys: "Ctrl+Space", what: "Show suggestions" },
      { keys: "Hover a name", what: "See what a Nova function does" },
      { keys: "Click a problem", what: "Jump to the file and line" },
    ],
  },
  {
    area: "Scene editor",
    tips: [
      { keys: "Drag", what: "Move the selected thing (⇧ ignores snapping)" },
      { keys: "Arrows", what: "Nudge the selection" },
      { keys: "⌘D / Delete", what: "Duplicate / remove" },
    ],
  },
  {
    area: "Sprite editor",
    tips: [
      { keys: "B E G L R O I M", what: "Pencil, eraser, fill, line, rectangle, ellipse, colour picker, select" },
      { keys: "[ ]", what: "Smaller / bigger brush" },
      { keys: "← →", what: "Previous / next frame" },
      { keys: "Space", what: "Play the animation" },
    ],
  },
  {
    area: "Music, sounds and models",
    tips: [
      { keys: "Space", what: "Play / stop (songs and sounds)" },
      { keys: "Right-click a note", what: "Remove it" },
      { keys: "Arrows, PageUp/PageDown", what: "Move the selected cube or part" },
    ],
  },
];
