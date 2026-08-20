# Mirasim Skin Manager

Skin the [Mirasim](https://github.com/mirasim-ai/mirasim) desktop app, switch skins from
inside the app, and keep them across app updates. Ships with **Clove** — a smoke-and-butterflies
skin in the pastel-punk idiom of VALORANT's Clove.

![Clove skin](docs/clove.png)

- **F9** — skin picker (stock UI is always one click away)
- **F5** — reload the window (the app ships no native menu, so the loader restores this)
- Skins are plain folders outside the app, so editing one is just editing a file + F5
- An app update drops the loader; the optional scheduled task puts it back on its own

## How it works

Mirasim's window loads `dist/renderer/index.html` straight out of the packaged `app.asar`,
so `install.mjs` injects one small loader script there — that is the only change to the app.
Everything that matters lives **outside** the app, at `%USERPROFILE%\.mirasim\skins`: the skins
themselves, plus your pick in `localStorage`. Updates replace the asar (and the loader with it),
never your skins.

The loader mounts the active skin's `skin.css` / `skin.js` and owns the picker. The app's CSP
(`script-src 'self'`) allows this because a `file://` document treats other `file://` resources
as same-origin by scheme.

`install.mjs` also patches two colors in the main process that CSS cannot reach: the window
controls strip becomes fully transparent (so the page's gradient shows through behind the
caption buttons), and the pre-paint background color goes dark purple instead of near-black.
Both are optional — the installer warns and carries on if a new app build renames them.

## Install

Requires Windows, Node 18+, and Mirasim installed.

```sh
npm install
node install.mjs
```

Then **fully quit Mirasim and relaunch** (the asar is read at startup). Press **F9** to pick a
skin — Clove is the default on first run.

Non-standard install location? Set `MIRASIM_RESOURCES` to your Mirasim `resources` folder.
Want the skins somewhere else? Set `MIRASIM_SKINS_DIR`.

### Keep it through app updates (optional)

```powershell
powershell -ExecutionPolicy Bypass -File register-autosync.ps1
```

Registers a scheduled task that runs hidden every minute and at logon. When it sees the
loader missing from whatever the app currently renders from, it re-runs `install.mjs`.
Restart the app once afterwards and the skin is back. The update lands while the app is
quitting, so expect the first relaunch after an update to be unskinned — the task heals it
within a minute, and the next launch has everything.

Mirasim updates two ways and both drop the loader: the full installer replaces
`resources/app.asar`, while an in-app update downloads `~/.mirasim/app/<version>` and points
`state.json` at it — after which the window renders from that folder and the patched asar goes
unused. The task watches both. It refuses to touch a half-written asar,
logs to `autosync.log`, and does nothing at all when everything is already in place.

Remove it with `Unregister-ScheduledTask -TaskName MirasimSkinAutoSync`.

### Uninstall

```sh
node install.mjs --restore
```

Restores the official asar from the backup `install.mjs` keeps beside it
(`app.asar.skinmgr.bak`). Your skins folder is left alone.

## Writing a skin

A skin is a folder in `%USERPROFILE%\.mirasim\skins`:

```
my-skin/
├── skin.json      name, author, description, accent color
├── skin.css       required
├── skin.js        optional — effects, pets, hotkeys
└── assets/        images, fonts, whatever
```

`skin.json`:

```json
{
  "label": "My Skin",
  "author": "you",
  "version": "1.0.0",
  "description": "one line, shown in the picker",
  "accent": "#b07dff"
}
```

Drop the folder in, double-click `sync-skins.cmd` (rebuilds the picker's manifest), press F5.

Two rules worth knowing:

- **CSS** can use relative paths — `url(./assets/foo.png)` resolves against the CSS file.
- **JS must use `window.__SKIN_ROOT`** for asset URLs. Relative paths in JS resolve against the
  app document inside the asar, not your skin folder. The loader sets `__SKIN_ROOT` before
  running `skin.js`.

Style the app by overriding its own theme tokens — `--surface-*`, `--th-*`, `--radius-*`,
`--font-sans`, `--font-mono` and friends. `skins/clove/skin.css` is a complete worked example.

## The Clove skin

Ink-purple surfaces, smoke-to-jacket gradients, and butterflies that behave like they live there.

- Shard-winged butterflies drawn in code, after Clove's own ability icons
- A butterfly pet that perches, relocates, startles at your cursor, and **bursts into particles
  and comes back** when clicked — drag it, right-click it for a menu
- Ambient drift: butterflies crossing the window, rising light dust, slow smoke plumes,
  breathing corner glows — all compositor animations, no idle rAF loop
- Click feedback: a double halo, petal dust, and sometimes a butterfly slipping out
- Usage popover: meters sweep from empty with a butterfly riding the tip, rows drift up out of
  the mist, a light sheen crosses the bar, the refresh control is a butterfly
- **NOT DEAD YET** — a banner and a resurrection when a session fails
- DIN-lineage type (Bahnschrift), condensed micro-labels, Cascadia Mono for code

Hotkeys: **Alt+Shift+B** butterfly swarm · **Alt+Shift+M** hide/show the pet ·
right-click the pet for quiet mode, reposition, or the skin picker.

Everything respects `prefers-reduced-motion`, and quiet mode stops the ambience entirely.

## Credits & disclaimer

Clove is a character from **VALORANT**, © Riot Games. This is an unofficial, non-commercial fan
project made under [Riot's Legal Jibber Jabber](https://www.riotgames.com/en/legal) fan-content
policy; it is not endorsed by or affiliated with Riot Games. The wallpaper in
`skins/clove/assets/` is Riot's key art, included for that non-commercial fan use — swap in your
own image if you would rather not ship it. All other artwork in the skin (butterflies, smoke,
sparkles, HUD marks) is original geometry drawn in code.

The code is MIT-licensed (see `LICENSE`); the license covers the code, not the game artwork.

## 中文说明

给 Mirasim 桌面端换肤，**F9** 呼出皮肤面板，**F5** 重载界面。皮肤是 `%USERPROFILE%\.mirasim\skins`
下的普通文件夹，app 更新不会丢；asar 里只注入一个几 KB 的加载器。

安装：`npm install` → `node install.mjs` → **完全退出并重开 Mirasim**。
更新后自动恢复：`powershell -ExecutionPolicy Bypass -File register-autosync.ps1`（每 3 分钟静默检查，
发现加载器被更新覆盖就自动重装，之后重开一次 app 即可）。还原官方界面：`node install.mjs --restore`。

自制皮肤：建个文件夹放 `skin.json` + `skin.css`（可选 `skin.js`、`assets/`），双击 `sync-skins.cmd`，按 F5。
注意 JS 里取资源必须用 `window.__SKIN_ROOT`，CSS 用相对路径即可。

内置 Clove 皮肤：紫粉烟雾配色、代码绘制的碎片刃翼蝴蝶、会重生的蝴蝶桌宠、氛围蝶群与光尘、
点击光圈、用量面板动画、会话失败时的 NOT DEAD YET。快捷键 Alt+Shift+B 放蝶群、Alt+Shift+M 收桌宠。
本项目为非商业同人作品，Clove 与 VALORANT 版权归 Riot Games 所有，与 Riot 无关联。
