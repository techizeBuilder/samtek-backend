# Dev server "JavaScript heap out of memory" — what was changed (2026-10-31)

## The problem
`npm run dev` crashed while the server was still loading its routes:

```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

It started a few days earlier on restarts only, then on 31 Oct also on a fresh start. The crash came at
about **2 GB** of memory.

## The cause
- `npm run dev` runs `nodemon --exec ts-node index.js` (`package.json` → `scripts.dev`).
- By default **ts-node type-checks** every file it loads. Our `tsconfig.json` has `"allowJs": true` and
  `"rootDir": "../"`, so every JavaScript file the server imports (all controllers, services, models)
  was pulled into one TypeScript program and type-checked — and that whole program stays in memory.
- The code base has grown a lot (several controllers are 3,000–5,000 lines), so that program passed the
  ~2 GB heap limit.
- The type-checking gave us nothing: the code is plain JavaScript and `"strict": false`, so no type error
  was ever enforced.

**Why `$env:NODE_OPTIONS="--max-old-space-size=4096"` didn't help:** the crash was still at ~2 GB, so
the setting never reached that run (it has to be set in the **same** PowerShell window, right before
`npm run dev`). Even then it would only have delayed the crash as the code keeps growing.

## The fix — one setting
File: `server/tsconfig.json` — added at the top:

```json
"ts-node": {
  "transpileOnly": true
},
```

ts-node now only **converts** each file (the same ES-module → CommonJS conversion as before) and skips
the type-checking. Nothing else changed: no code, no `package.json`, no nodemon setting.

**Measured after the fix:** all 90 route files plus everything they import load in about 13 seconds at
about 200–400 MB (before: past 2 GB and a crash).

## Does it affect production?

| How production starts the server | Affected? |
|---|---|
| `npm start` / `node index.js` (the `start` script in `package.json`) | **No.** ts-node isn't used at all, so its settings are never read. |
| `npm run build` (`tsc`) then running `dist/` | **No.** `tsc` ignores the `"ts-node"` section; the build output is the same. |
| PM2 / a service / Docker that runs **`ts-node index.js`** (like dev) | **Only for the better:** it no longer type-checks, so it starts faster and uses far less memory. The code that runs is the same. |

The repository has no PM2 / Docker / deploy config, so check on the production server which of these it
uses (e.g. `pm2 list` → the process's "script" / "interpreter", or the service / Docker start command).

## If something goes wrong
1. **The heap crash is back in dev:** first check `server/tsconfig.json` still has
   `"ts-node": { "transpileOnly": true }` — someone may have replaced the file.
2. **To undo the fix:** delete those three lines from `tsconfig.json`. ts-node goes back to type-checking
   (and the memory problem comes back).
3. **A temporary extra margin** (only if ever needed), in the same PowerShell window:
   ```powershell
   $env:NODE_OPTIONS="--max-old-space-size=4096"
   npm run dev
   ```
4. **"Something works in dev but not in production"** can't come from this change: it only changes
   whether ts-node type-checks, not what code runs.

## What we lose
Nothing in practice. With type-checking on, ts-node would have refused to start on a type error in JS;
with `"strict": false` and plain JavaScript that never happened. If type-checking is ever wanted, run it
on its own, outside the dev server (e.g. `npx tsc --noEmit`, which needs its own memory).
