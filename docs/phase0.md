# Phase 0: evaluate JEV on your own photos

Goal (PRD-SEC-008): find out whether JEV finds and recognises real household objects well enough.
The gate is at least 12 annotated photos, 90 % precision and 80 % recall at IoU ≥ 0.5, with
repeated instances and identity errors reported separately.

## 1. Take the photos

Take at least 12 photos, more if possible:

- **One room from two viewpoints.** At least one object should appear in both, such as a lamp.
- **Lookalikes.** Two identical or nearly identical items, such as cups or chairs.
- **An empty area,** such as a bare wall or an empty part of the floor.
- **Poor light.** A couple of photos in the evening or against a window.
- **A second room** with a few of the same kinds of objects.
- **Room 1 again, after moving something** (one item moved, one hidden).

Hold the phone the way you normally would. Portrait and landscape are both fine. Use JPEG or PNG; HEIC is not supported, so on iPhone set *Settings → Camera → Formats → Most Compatible* or export as JPEG.

File names may only use letters, digits, `.`, `_` and `-`, for example `living-doorway-1.jpg`.

## 2. Annotate

```sh
nvm use && npm install
npm run dev
```

1. Open http://localhost:5173/phase0/annotate and choose the photos. They are never uploaded anywhere.
2. For each photo, set the room and viewpoint, and tick the conditions.
3. Drag a box around **every clearly visible object** and give it a name.
4. When the **same physical item** appears in another photo, give it the **same object key**. The key list suggests keys you already used. Different items always get different keys, even when they look identical (`cup-1`, `cup-2`).
5. Mark half-hidden items as **Partly hidden**. They are neither required nor penalised.
6. Switch to **Empty regions** and mark areas with nothing in them.

The draft autosaves in the browser. After a reload, choose the photos again to see them.

## 3. Export and run

Export `groundtruth.json`. Put it and the photos in one folder under `private-fixtures/`, which is git-ignored:

```text
private-fixtures/home-2026-10/
  groundtruth.json
  living-doorway-1.jpg
  ...
```

Then:

```sh
# Shows the planned number of requests without sending anything
npm run eval -- --fixtures private-fixtures/home-2026-10 --provider jev --dry-run

# Real run. Paid, never retried, capped by --max-requests.
npm run eval -- --fixtures private-fixtures/home-2026-10 --provider jev --confirm-paid --max-requests 80
```

- Expect up to 5 requests per photo and 1 per identity pair, at fractions of a cent each.
- `OPEN_ROUTER_API_KEY` is read from `.env`.
- Reports are written to `eval-results/`, which is git-ignored because they reference your photos.

Read `report.md`:

- **Precision:** of the boxes JEV proposed, how many were real objects.
- **Recall:** of the objects you marked, how many JEV found.
- **Repeated-instance failures:** cases where two identical items became one box, or one was missed.
- **Identity, false-same rate:** different items proposed as "the same". This is the costly error.

Privacy: running the evaluation sends your photos and crops to OpenRouter and TypeSafe. Retention is not documented (see [jev-contract.md](jev-contract.md)). Only use photos you are comfortable sending.

## Useful options

| Option | Meaning |
| --- | --- |
| `--images a,b` | Only these image ids |
| `--no-identity` | Skip identity pairs |
| `--max-identity-pairs 20` | More identity pairs; default 10 |
| `--provider demo` | Free pipeline check with fake detections, labelled Demo |
