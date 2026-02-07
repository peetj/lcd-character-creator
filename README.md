# LCD Character Creator (Modern)

A modern remake of <https://maxpromer.github.io/LCD-Character-Creator/> built with **Vite + React + TypeScript**.

## Features

- 5×8 pixel editor (click/drag painting)
- Arduino code generation
  - Parallel (`LiquidCrystal`)
  - I2C (`LiquidCrystal_I2C`)
  - Output as **Binary** (`Bxxxxx`) or **Hex** (`0x00`..`0x1F`)
- **Copy code**
- **Undo/redo**, clear, invert
- **Save/Load** characters (localStorage)
- **Export/Import** JSON (single character or full saves list)
- **Shareable URL** (encodes the bitmap + settings in query params)

## Dev

```bash
pnpm install
pnpm dev
```

## Build

```bash
pnpm build
pnpm preview
```

## GitHub Pages deploy

If you deploy under a repo sub-path (e.g. `https://USER.github.io/REPO/`), set Vite’s `base`.

Option A (recommended): edit `vite.config.ts`:

```ts
export default defineConfig({
  base: '/REPO/',
  plugins: [react()],
})
```

Option B: set `base` only in CI by writing it into the config before building.
