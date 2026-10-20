# HomeTrace — Product Requirements Document

Version: 1.3 | Date: 19 October 2026 | Product owner: Sten Hougaard

Status: Ready for technical validation and implementation planning. This document specifies a prototype; JEV detection and physical-object identity accuracy have not been measured.

Product name: **HomeTrace**. Repository: `home-trace`. The application UI, documentation, code comments, and developer-facing text must be in **English**.

## PRD-SEC-001 — Overview and objectives

HomeTrace is a mobile web application that creates a visual inventory of visible household belongings and compares later observations. The user walks through their home with a live camera preview, deliberately triggers a scan, and reviews a frozen image with marked objects.

When revisiting a viewpoint, the app displays a previous image as an adjustable transparent overlay over the live feed. The user aligns the camera using fixed features and taps **Ready — scan**. The app proposes which objects have been found again, possibly moved, newly registered, or not rediscovered. Uncertain identity is resolved through **Same object? Yes / No / Skip**.

Product promise: **Give your home a visual memory. Register your belongings room by room, then see what you find again and what looks different.**

### Confirmed product decisions

| Area | Decision |
| --- | --- |
| Name | HomeTrace |
| Language | English code and documentation; UI strings localized to Danish, English, Spanish, Chinese |
| Platform | Responsive SvelteKit web application designed primarily for phones |
| Deployment | SvelteKit on Netlify (free tier): client UI plus a small private server function for the provider proxy |
| Camera | Live preview; image analysis starts only after an explicit button press |
| Review | Freeze the captured frame and mark detected objects |
| Identity | AI proposes existing-object matches; the user resolves uncertainty |
| Organization | Rooms with multiple named viewpoints |
| Revisits | Adjustable transparent reference image over live video (CSS opacity, composited on the GPU by the browser) |
| Storage | Inventory and images stored on the device, without an account or login |
| Portability | Export/import a ZIP containing JSON and image files; same-device deep links via URL state |
| Integration | Evaluate and use JEV Images where its measured capabilities support the task |

### Working assumptions

1) The first audience is a person inventorying their own home. Sten is the initial prototype tester.
2) MVP supports one home per local database, multiple rooms, and multiple viewpoints per room.
3) MVP does not automatically approve physical-object identity. Every proposed link between a new observation and an existing object is reviewed by the user.
4) A private, transient API proxy may transport analysis images but must not retain the home database or images.
5) Stack choices, budgets, import limits, and evaluation targets below are recommendations rather than additional decisions already confirmed by the user.

### Success criteria

1) Scan two viewpoints in a room and associate observations of the same physical item with one stable object ID.
2) Revisit a viewpoint using the overlay and review changes without relying on memory of previous positions.
3) Export and import into an empty database while preserving IDs, images, observations, and user decisions.
4) Make no AI requests when moving the camera, opening a list, or importing local data.
5) Explain uncertainty without claiming that the entire home has been inventoried or a hidden item has disappeared.

### Scope boundaries

MVP covers visible physical items within selected fields of view. Contents of closed cupboards are unknown. It excludes 3D mapping, continuous object tracking, precise distance measurement, automatic surveillance, insurance valuation, and guaranteed inventory completeness. Two identical, unmarked items may be visually indistinguishable.

## PRD-SEC-002 — Target audience and needs

Primary user: A person who wants an overview of their belongings and changes at home without maintaining a spreadsheet.

| User need | Product response |
| --- | --- |
| What have I registered? | Inventory with images, categories, rooms, and latest observations |
| Have I photographed this part of the room? | Viewpoint thumbnails and scan history |
| Is this the same item as before? | Previous/current crops shown together with a confirmation prompt |
| What looks different? | Compare with an explicitly selected previous scan |
| What has not moved? | Items found again with no change detected in the compared viewpoint |
| Can I keep my data? | Open, versioned JSON and a portable ZIP with images |

The inventory lists registered belongings, not everything physically present in the home. **Last seen** is a dated observation, not a guarantee of current location.

## PRD-SEC-003 — Core features and acceptance criteria

### PRD-FEAT-001 — Home, rooms, and viewpoints

1) Create and rename rooms, such as **Living room**.
2) Create multiple named viewpoints, such as **From the doorway** and **Bookshelf from the sofa**.
3) Select the room before scanning. Display the active room and viewpoint beside the capture action.
4) Preserve scan history per viewpoint and explicitly select its reference scan.

Acceptance: Two viewpoints in the same room can have different references. A new scan does not automatically replace a reference. One item can have observations from both viewpoints without duplicate inventory entries.

### PRD-FEAT-002 — Camera and deliberate scanning

1) Request camera permission and prefer the rear camera. Do not request microphone access.
2) **Scan** captures one clean camera frame, freezes it, and starts one bounded analysis job.
3) Never include the reference overlay, object boxes, or other UI in the captured image sent for analysis.
4) Display job progress and allow cancellation of remaining requests. An already dispatched provider request may still be billed.
5) Persist a local snapshot draft before making network requests. After failure, allow manual review or an explicit retry.

Acceptance: Ten seconds of live preview produces zero analysis requests. Double-tapping creates at most one job. Rotation during analysis does not change the frozen frame. Denied camera permission produces an actionable explanation and an existing-image selection option for testing.

### PRD-FEAT-003 — Object discovery and annotations

1) Analyze the frozen frame for visible object candidates.
2) Display numbered boxes with a name/category. Tapping a box opens its object card.
3) Allow editing names, categories, and boxes, dismissing false detections, and manually marking missed objects.
4) Represent separate physical instances individually, including two cups on one table.
5) Display **Analysis complete — some items may have been missed**. Distinguish no detections, partial results, and technical failure.

Acceptance: Boxes refer to the same image region across screen sizes and rotation. Store normalized coordinates relative to the correctly oriented captured image. Reject invalid provider coordinates. Manual registration works without AI.

Critical dependency: Automatic discovery of multiple objects is a product requirement to validate in Phase 0. JEV's documented single-box capability is not itself a complete object list. Manual marking supports the user and enables testing the rest of the app; it does not establish that automatic discovery works.

### PRD-FEAT-004 — Same object? Yes / No / Skip

1) Select a small candidate set of existing objects, prioritizing the room and optionally searching other rooms.
2) Show the best candidate using previous/current crops, name, and last observed room/date.
3) **Yes** links the observation to the candidate's stable object ID.
4) **No** rejects that specific match. Offer another candidate, manual selection, or creation of a new item.
5) **Skip** retains an unresolved observation without counting it as a confirmed additional item.
6) Allow correcting confirmed matches, merging duplicates, and undoing those changes.

Acceptance: **No** does not automatically create an object. A proposal cannot alter existing identity before confirmation. Remember rejected candidate pairs for that observation. Identical chairs may remain unresolved. Within one scan, linking two distinct detections to the same object ID requires explicit duplicate review.

### PRD-FEAT-005 — Transparent reference over live video

1) Select a room, viewpoint, and previous reference scan.
2) Overlay the reference on live video with opacity adjustable from 0 to 80 percent; suggested default: 40 percent.
3) Show the full reference within a clear image frame. Do not hide aspect-ratio differences using arbitrary cropping.
4) Display **Align using doorframes, walls, and other fixed features**.
5) **Ready — scan** captures a clean current frame and starts comparison with the selected reference.

Acceptance: Opacity changes locally without requests. Reference and live-frame transformations account for orientation and aspect ratio. Do not claim automatic 3D positioning. Flag a comparison as **Uncertain viewpoint** if the images cannot reasonably be compared.

### PRD-FEAT-006 — Continue registering and compare

Provide two clearly named modes:

1) **Continue registering**: Add observations and potentially new items without declaring earlier items absent.
2) **Compare with previous**: Compare detections with the selected reference and present change proposals.

| Display status | Meaning |
| --- | --- |
| Found again — no change detected | Identity confirmed; no change detected in this comparison |
| Possibly moved | Same item found, but position appears different; review required |
| Moved — confirmed | User confirmed a changed location |
| New to inventory | User created a new item; it may have been in the home for years |
| Not rediscovered in this scan | A previous observation exists without a securely linked current observation |
| Unresolved | Identity, visibility, or comparability is insufficient |

Acceptance: An item outside the current field of view must not be classified as removed. A chair hidden behind a table may be **Not rediscovered**. Changed 2D box coordinates alone cannot confirm physical movement. Poor alignment makes position uncertain. The answer to “What has not moved?” is labeled **Found again with no change detected**, explaining that movement between scans cannot be ruled out.

### PRD-FEAT-007 — Inventory and history

1) Show confirmed items with thumbnail, user-defined name, category, and last observed room/date.
2) Search names and filter by room, category, and review status.
3) Open an item to see observations from multiple viewpoints and dates.
4) Keep unresolved detections separately visible with their own count.
5) Allow renaming and adding a short note.

Acceptance: Inventory totals count unique active object IDs. Five photos of the same confirmed lamp count as one lamp. Historical observations retain their original rooms when an item is later found elsewhere.

### PRD-FEAT-008 — Local persistence and recovery

1) Store metadata, images, and drafts in IndexedDB.
2) Persist each decision atomically. Reopening restores committed state and unfinished drafts.
3) Display the latest export time and estimated storage usage where available.
4) Request persistent browser storage where supported; refusal must not block the app.
5) Never automatically delete reference images or history to resolve storage pressure.

Acceptance: Closing after a confirmed match preserves the decision. Local review works without a connection once the application is loaded. AI analysis requires connectivity. Export reminders explain that browser data can be cleared; local persistence alone must not be described as backup.

### PRD-FEAT-009 — ZIP export and import

1) Export one ZIP containing manifest.json, inventory.json, and an assets/ directory with images and crops.
2) Use versioned UTF-8 JSON that is readable independently of the app.
3) Also offer JSON-only export, labeled **Without image files**. ZIP is the default for complete restoration.
4) Preview room, object, and image counts before import. MVP replaces the local home after explicit confirmation; it does not merge databases.
5) Validate schema, references, file sizes, paths, and image formats before modifying the database.

Acceptance: A complete round trip preserves references and user decisions. Missing assets, unknown future schema versions, and unsafe ZIP paths are rejected without changing existing data. Failed import rolls back. Offer export of the current home before replacement.

### PRD-FEAT-010 — Analysis budgets, errors, and transparency

1) One press authorizes one bounded job, potentially including multiple JEV questions or requests using the captured frame and relevant reference crops.
2) Suggested MVP limits: At most 20 provider requests per job and 3 concurrent requests. Adjust after measurement.
3) Display dispatched request count, duration, and known provider usage. Show currency amounts only with a verified pricing basis.
4) Do not automatically resend after a network failure or reload. Provide **Retry**, explaining that an earlier request may already have been billed.
5) Keep technical logs without image content or secrets.

Acceptance: Recursive discovery cannot exceed the job budget. Interrupted jobs do not restart on reopen. Partial results are labeled and reviewable. Mock results always display **Demo**.

## PRD-SEC-004 — Technical recommendations and integration

### Proposed architecture

| Component | Recommendation | Reason |
| --- | --- | --- |
| Frontend | SvelteKit and TypeScript | Fits the owner's experience and supports clear component boundaries |
| Deployment | SvelteKit with adapter-netlify, Netlify Blobs for the server-side budget counter | Free HTTPS hosting with server functions; chosen 20 October 2026 (Deno Deploy was ruled out) |
| Local database | IndexedDB through a typed repository, optionally Dexie | Structured data plus binary images |
| Camera/image layers | getUserMedia, video, canvas, SVG overlays, and a CSS-opacity reference layer | Separate clean image capture from annotations; the browser composites the overlay on the GPU |
| Validation | JSON Schema or Zod plus explicit schema version | Validate imports and adapter output |
| Archive | ZIP library with size limits and path validation | Portable self-contained export |
| AI interface | Provider adapter with mock and JEV implementations | Test workflows without inventing provider contracts |
| API transport | Small private proxy/server route, optionally SvelteKit on Node | Keep provider credentials outside the client bundle |
| State persistence | Query string and IndexedDB | Resume sessions and deep-link on the same device; preserve local state across reloads |
| Offline shell | Service worker after the core flow works | Local review after initial load |

These are recommendations. No cloud inventory database, user-account system, or server-side image archive is required.

### Performance and device targeting

- Load time is **nice-to-have** rather than critical; prioritize simplicity and correctness.
- Target modern browsers and recent phones (iPhone 11+, Android 8+) with 2+ GB RAM.
- The overlay uses CSS opacity, which browsers composite on the GPU. Decided 20 October 2026: WebGL shaders add code and device risk without a visible benefit for a single blended layer; revisit only for effects such as difference blending.
- Lazy-load heavy components and images; avoid blocking the camera preview on startup.

### Internationalization (i18n) and styling

**UI localization**: Support Danish (`da`), English (`en`, default), Spanish (`es`), and Simplified Chinese (`zh`). Store UI strings outside components using a typed i18n system (e.g. `svelte-i18n`). Keys follow the pattern `screen.action.label`, e.g. `camera.capture.scan`.

**Code and documentation**: All code, comments, error messages, README, and developer documentation remain in English.

**Typography**: Use the following font stack throughout the application as the default:
```css
font-family: Avenir, Montserrat, Corbel, 'URW Gothic', source-sans-pro, sans-serif;
font-weight: normal;
```

Exceptions: Use monospace fonts (e.g. `Courier New`, `Monaco`) only for technical content such as code snippets, error logs, or input fields where monospace improves clarity. Do not override the base font-weight without justification.

### Verified JEV information as of 19 October 2026

According to TypeSafe's official release dated 14 October, image input is experimental and enabled with `TypeSafe-Danger-Zone-Images: true`. The `box` type returns a single box and was introduced for `jev-1.14.0`. The announcement does not document a detector that enumerates all items in a scene. [1]

Therefore, evaluate JEV on specific presence, box, and identity questions. Establish from official documentation and actual responses how to discover unknown items, handle repeated instances, and suppress boxes when a target is absent. The official images/box documentation pages could not be opened during research. Exact HTTP payloads, response fields, limits, and prices are intentionally not specified here.

Update 19 October 2026: the official Box and Images pages and the OpenRouter Jev guide have since been read, and live requests confirmed the contract. JEV is reachable as `typesafe/jev-1.14` through the OpenRouter Decisions API. A Box answer is always exactly one box, with no "not found" answer. There is no list-of-boxes type. The verified contract, limits, prices and first Demo measurements are kept in `docs/jev-contract.md`, which is the source for the adapter.

### Session URLs and state persistence

The application uses query string parameters to preserve and share scan sessions:

- `?home=<uuid>&room=<uuid>&viewpoint=<uuid>&mode=register|compare&reference=<scan-uuid>`
- `?session=<uuid>` for resuming a specific analysis job or scan context

These URLs allow users to:
1. Resume analysis or review after a browser reload without losing context.
2. Deep-link into a specific comparison or inventory state on the same device.
3. Bookmark a viewpoint for a quick revisit.

Data lives only on the device, so a URL is a reference, not a copy. Opened on another device or in an empty database, the app shows **This session is not on this device** and offers ZIP import. Sharing data with another person means sharing an export.

State is persisted to IndexedDB atomically; the query string supplements but does not replace local storage. Load the app with a query string, retrieve matching data from IndexedDB, and restore the UI state without re-scanning or re-analyzing.

**Critical constraint**: Never encode sensitive data (provider credentials, API keys, or image payloads) in query strings. State parameters reference local database UUIDs only.

### Phase 0 must establish

1) Current official endpoint, authentication, SDK version, image formats, limits, and measured latency.
2) Whether JEV alone can generate useful object candidates or requires a bounded category set and manual marking.
3) How to verify presence before accepting a box. A box alone is not evidence that a target exists.
4) Matching performance across crops, viewpoints, lighting, and visually identical items.
5) Whether batching questions preserves quality and the actual cost of a typical scan.
6) Current provider image-processing and retention practices before a public pilot uses private household imagery.

If automatic discovery does not meet the evaluation target, document the limitation. The owner may then choose an additional detector behind the adapter boundary. Do not silently send images to another provider or incur additional provider charges.

On 20 October 2026 the owner asked for a vision-language model detector (via OpenRouter) to be evaluated next to JEV in Phase 0. It sits behind the same adapter boundary as provider `vision`. The contract and first Demo measurements are in `docs/vision-contract.md`. Choosing it for the product remains a decision after evaluation on real photos.

### Application-level analysis contract

The following is an internal application contract, not the JEV HTTP request/response format:

```ts
type Box = { x: number; y: number; width: number; height: number };
type Detection = {
  id: string;
  label: string;
  category: string | null;
  box: Box; // Normalized to 0..1 in the correctly oriented captured frame.
  source: 'jev' | 'vision' | 'manual' | 'demo'; // 'vision': optional extra detector, see PRD-SEC-009
  providerConfidence: number | null;
  presence: 'supported' | 'uncertain';
};
type MatchProposal = {
  observationId: string;
  candidateObjectId: string;
  outcome: 'possible_same' | 'unlikely_same' | 'uncertain';
  providerConfidence: number | null;
};
```

Do not present provider confidence as a calibrated probability of correct physical identity without evaluating that calibration. Missing confidence values remain null; never invent numbers.

### Analysis flow

1) Capture a clean snapshot and persist a draft with its job ID and selected reference.
2) Normalize pixel orientation, resize to verified provider limits, and strip unnecessary metadata.
3) Discover candidates using the validated method; verify presence and box validity.
4) Generate reference crops locally and select a small candidate set using metadata and optionally local visual features.
5) Ask JEV for identity/change proposals within the job budget.
6) Show the frozen image and proposals. Commit object links only after user decisions.
7) Derive comparison results from confirmed links, image comparability, and user review.

Retries and explicit additional analysis use the same snapshot. Do not capture a new frame in the background. The proxy must not retain images permanently. Logs and error reports must not contain base64 image data.

### Mobile constraints

Camera access requires permission and normally a secure context. Do not assume a phone opening a plain HTTP development address on a LAN will have camera access; use HTTPS for device testing. [2]

IndexedDB supports structured data and files/blobs. Browser storage is subject to quotas and eviction. ZIP export provides a portable copy. [3][4]

Test on actual iPhone Safari and Android Chrome, portrait/landscape, rear camera, background/resume, and image scaling. Record tested OS/browser versions in the implementation README.

## PRD-SEC-005 — Conceptual data model and export format

Use stable UUIDs and UTC ISO 8601 timestamps; render times in the user's local timezone. Store metadata separately from image assets.

| Entity | Main fields | Relationships |
| --- | --- | --- |
| Home | id, name, createdAt | Owns rooms and inventory objects |
| Room | id, homeId, name | Has multiple viewpoints |
| Viewpoint | id, roomId, name, referenceScanId: string/null | Has multiple scans |
| Scan | id, viewpointId, capturedAt, mode, imageAssetId, referenceScanId, status | Owns observations; retains the reference selected for this scan |
| Asset | id, path, mimeType, width, height, byteLength, sha256 | Full image or crop |
| InventoryObject | id, homeId, name, category: string/null, notes, createdAt, mergedIntoId: string/null | Has many observations |
| Observation | id, scanId, objectId: string/null, box, cropAssetId, label, source, resolution | One occurrence within a scan |
| MatchDecision | id, observationId, candidateObjectId, answer, decidedAt | Records Yes/No/Skip decisions |
| ComparisonItem | id, scanId, baselineObservationId, currentObservationId: string/null, identityState, visibilityState, movementState, reviewedAt | One baseline observation's result in a specific comparison |
| AnalysisJob | id, scanId, provider, model, status, callCount, usage, startedAt, finishedAt | Technical metadata without secrets |
| ReviewEvent | id, entityType, entityId, action, previousValue, createdAt | Corrections, merges, and undo |

### Data invariants

1) An observation belongs to one scan and at most one item. Unresolved observations have objectId = null.
2) Inventory totals count active items, never observations. Merged items point to one active canonical ID while preserving history.
3) Last observed room derives from the latest confirmed observation. Never overwrite historical room assignments.
4) Change status belongs to a comparison, not permanently to an item.
5) Box coordinates are image coordinates, never a 3D position in the home.
6) Changing a viewpoint reference affects future scans. Historical comparisons retain their original reference IDs.
7) Later AI output cannot override a user-confirmed identity without a new user decision.

### State values

Scan.status: draft | analyzing | review | complete | failed | cancelled.

Scan.mode: register | compare.

Observation.resolution: unresolved | linked | created | ignored.

ComparisonItem.identityState: confirmed | rejected | unresolved.

ComparisonItem.visibilityState: found | not_rediscovered | uncertain.

ComparisonItem.movementState: no_change_detected | possibly_moved | confirmed_moved | unknown.

Identity, visibility, and movement are independent: A confirmed identity can still have unknown movement. Matching identity alone does not establish unchanged position.

### ZIP layout

```text
manifest.json
inventory.json
assets/<asset-id>.jpg
assets/<crop-id>.jpg
```

The manifest includes schemaVersion, appVersion, exportedAt, homeId, and asset entries with paths, byte lengths, and SHA-256 hashes. inventory.json contains entity arrays with the relationships above. Never export credentials or raw provider requests.

Illustrative manifest; bracketed placeholders are populated by the exporter:

```json
{
  "schemaVersion": "1.0.0",
  "appVersion": "0.1.0",
  "exportedAt": "2026-10-19T19:30:00Z",
  "homeId": "[uuid]",
  "inventoryPath": "inventory.json",
  "assets": [
    {
      "id": "[asset-uuid]",
      "path": "assets/[asset-uuid].jpg",
      "byteLength": 123456,
      "sha256": "[64 hexadecimal characters]"
    }
  ]
}
```

Suggested adjustable MVP import limits: 100 MiB compressed archive, 300 MiB expanded contents, 2,000 files, and 20 MiB per image. Enforce expanded-size limits while reading, not just through archive metadata. Explain oversized imports without silently importing a subset. Do not load external image URLs or executable content from imported data.

## PRD-SEC-006 — UI design principles and user journeys

### Design system

**Font**: All text uses the base font stack `Avenir, Montserrat, Corbel, 'URW Gothic', source-sans-pro, sans-serif` with `font-weight: normal` by default. Monospace fonts may be used for technical content (logs, error codes, input fields) where clarity is improved.

**Localization**: All UI text is localized to Danish, English (default), Spanish, and Simplified Chinese. Code comments, error logs, and documentation remain in English. Use keys organized by screen and feature, e.g. `camera.capture.scan`, `inventory.search.placeholder`, and load translations from an i18n system outside component logic.

**Color and accessibility**: Never use color alone to communicate status. Pair every color with a label, icon, and number. The initial user is colorblind; ensure sufficient contrast and textual context.

### Main screens

| Screen | Content and primary action |
| --- | --- |
| Home | Rooms, inventory count, unresolved detections, latest export |
| Room | Viewpoint thumbnails, last scan, **New viewpoint** |
| Camera | Active room/viewpoint, mode, capture action, optional reference overlay |
| Review | Frozen image with numbered boxes and one active object card |
| Comparison | Reference/current images with synchronized annotations and status list |
| Inventory | Search, filters, object cards, and history |
| Data and settings | Export/import, local storage, analysis usage, demo/live indicator |

### Initial registration

1) Create **My home**, choose/create a room, and name a viewpoint.
2) Grant camera permission, aim, and tap **Scan**.
3) Review detected items on the frozen frame and correct annotations.
4) Confirm existing identity, create a new item, or skip.
5) Finish review. Suggest the first completed scan as the viewpoint reference.
6) Continue to another viewpoint. Previously registered items can be proposed as matches.

### Revisiting a viewpoint

1) Select room, viewpoint, and **Compare with previous**.
2) Adjust the transparent reference over live video using fixed features.
3) Tap **Ready — scan**.
4) Confirm possible identity matches and review proposed changes.
5) Review counts for found-again, possibly moved, newly registered, and not-rediscovered items.
6) Optionally select a new reference explicitly; preserve the previous scan in history.

### Interaction principles

1) Large touch targets, suggested minimum 44 × 44 CSS pixels, with the primary action within comfortable thumb reach.
2) Pair colors with labels, icons, and numbers. Red/green alone cannot communicate status; the initial user is colorblind.
3) Ask one identity question at a time and retain progress, such as **3 of 12 reviewed**.
4) Show previous/current crops at comparable sizes with access to full images.
5) Always distinguish proposals, confirmed results, and unresolved observations.
6) Provide readable opacity percentage, keyboard operation, and an accessible slider label.
7) Inventory and data management support keyboard and screen-reader use. Every image box has an equivalent text-list entry.
8) Use **No change detected** consistently. Never claim an object **Has not moved at any time**.
9) Preserve query string state during navigation to support same-device deep links and resume functionality.

## PRD-SEC-007 — Security and privacy

1) No user account in MVP. Household data stays in the browser profile; someone with access to that profile may be able to view it.
2) Before the first analysis, explain that the snapshot and necessary reference crops are transmitted for AI processing. The live video feed is not transmitted.
3) Keep provider credentials as server secrets, never in frontend bundles, URLs, logs, or exports.
4) **Never encode sensitive data in query strings.** State parameters reference local database UUIDs only; credentials and API keys are server-side only.
5) Restrict the proxy to a private test environment or temporary access control with a server-enforced aggregate budget. An anonymous public client must not have access to an unlimited shared provider budget.
6) Same-origin and CORS rules alone are not authentication. Document private prototype access during setup.
7) Do not create a server-side inventory database. Exclude image payloads from application logs, tracing, and crash dumps.
8) Render names and notes as plain text. Imported files are data, never executable code or instructions.
9) **Delete home** requires clear confirmation and offers export first. Delete all local metadata and assets belonging to that home.
10) MVP ZIP exports are unencrypted. Explain this at export because the archive contains private indoor imagery.
11) Verify the provider's current privacy/retention terms before a public pilot. Do not state an unverified retention guarantee.

## PRD-SEC-008 — Development phases and validation

### Phase 0 — Validate vision and identity

1) Prepare fixtures with known ground truth: one room, two viewpoints, repeated items, an empty region, and poor lighting.
2) Test JEV candidate discovery, presence, boxes, and same-item judgments.
3) Measure cost, requests per scan, latency, and errors. Establish the actual provider contract.
4) Document whether discovery needs a supplementary detector. Build other flows against clearly labeled fixtures meanwhile.

Proposed evaluation gate: Use at least 12 images with manually annotated target objects. Report precision, recall, and usable-box rate. Initial targets are 90 percent precision and 80 percent recall on selected clearly visible target objects, with IoU ≥ 0.5 for box matching. These are evaluation targets, not measured or promised JEV quality. Report repeated-instance failures and identity errors separately. If targets are missed, revise the detection method or scope before committing to the product promise.

### Phase 1 — Complete workflow prototype independent of AI quality

1) Rooms, viewpoints, camera, clean snapshots, and local database.
2) Object annotations, manual registration, and **Same object? Yes / No / Skip**.
3) Inventory, reference selection, and observation history.
4) ZIP export/import and complete round-trip validation.

Deliverable: The entire user journey works with clearly labeled demo detections.

### Phase 2 — JEV integration and comparisons

1) Verified adapter, private proxy, and enforced budgets.
2) Transparent overlay and user-confirmed identity matching.
3) Comparison statuses and manual confirmation of movement.
4) Real-device testing and fixture-based evaluation.

Deliverable: Scan one room from at least two viewpoints and complete a later revisit.

### Phase 3 — Stabilization

1) Error handling, recovery, storage pressure, and safe imports.
2) Accessibility, image-memory usage, and responsive layouts.
3) Offline application shell and clear offline/AI capability boundaries.

Estimate delivery time after Phase 0. A short hackathon can demonstrate the workflow; robust recognition of every household belonging is not a credible two-day commitment.

### Test scenarios

| ID | Scenario | Expected result |
| --- | --- | --- |
| T01 | First scan contains five clear items | Reviewable detections; missed items can be added manually |
| T02 | Same lamp appears from two viewpoints | After **Yes**, one item has two observations |
| T03 | Two nearly identical chairs | Separate observations; no automatic merge |
| T04 | **No** to a suggested lamp match | Reject that candidate; do not automatically create an item |
| T05 | Skip, close, and reopen | Unresolved observation remains without increasing confirmed inventory |
| T06 | Revisit with transparent overlay | Capture contains only the current camera frame |
| T07 | Chair visibly moved within comparable viewpoint | Suggest movement; confirm only after user review |
| T08 | Cup hidden behind a book | Not rediscovered or unresolved; never automatically removed |
| T09 | Camera moves but furniture stays | No confirmed movement based only on box displacement |
| T10 | Item moves from living room to kitchen | Existing item from another room can be selected; history remains |
| T11 | Empty target region or hallucinated box | Presence check/user dismissal prevents forced registration |
| T12 | Double-tap followed by timeout | One job; no automatic additional paid retry |
| T13 | Network lost after capture | Preserve draft; explicit retry or manual review |
| T14 | Export, clear database, import | Same IDs, decisions, and verified image hashes |
| T15 | Missing image or ../ archive path | Reject import; preserve existing home |
| T16 | Portrait/landscape and different aspect ratios | Correct boxes without hidden crop-induced displacement |
| T17 | Storage full during capture | Controlled failure, prior data intact, export offered |
| T18 | Incorrect merge then undo | Restore items and observations correctly |
| T19 | Select a new reference | Future comparisons use it; historical comparisons stay unchanged |
| T20 | Live preview for one minute | Zero AI requests until an explicit scan |
| T21 | Item moves away and back between scans | No change detected; no claim of continuous immobility |
| T22 | Inspect export and technical logs | No credentials, raw base64 requests, or retained private image payloads |
| T23 | Same visible item proposed for two detections | Warn before linking both detections to one ID in the same scan |
| T24 | Compare demo and live modes | Clearly labeled; fixture quality is not represented as JEV performance |

### Definition of done

1) Validate PRD-FEAT-001 through PRD-FEAT-010 and record results.
2) Document measured automatic-detection quality and limitations. A manual-only demo does not satisfy automatic registration.
3) Test camera, overlay, and recovery on at least one iPhone and one Android phone.
4) Validate export/import using IDs and image hashes in a clean database.
5) Keep secrets out of client code and exports; enforce the private analysis budget on the server.
6) Document setup, fixtures, provider limits, measured latency, and known issues in README.

## PRD-SEC-009 — Challenges and mitigations

| Challenge | Mitigation |
| --- | --- |
| “Every object” is an open-ended completeness claim | Evaluate against known ground truth, disclose coverage, support manual additions |
| JEV box returns one object region | Validate discovery and repeated-instance handling in Phase 0 |
| Identical items lack identifying details | Allow unresolved identity and user review; do not invent certainty |
| Lighting, reflections, and occlusion | Preserve crops, collect multiple views, expose uncertainty |
| Camera motion resembles object movement | Use alignment guidance/comparability checks; 2D displacement alone is insufficient |
| Hidden items appear missing | Scope absence to the scan; not rediscovered does not mean removed |
| Local database may be cleared | Visible export status, reminders, and a complete portable ZIP |
| Many images consume device resources | Bounded analysis resolution, thumbnails, lazy loading; no silent history deletion |
| One scan creates many paid questions | Visible request count and hard job/server budgets |
| Public unauthenticated proxy can be abused | Private prototype access; separate access design before a public pilot |

### Decisions after the first technical evaluation

1) Is JEV alone sufficient for discovery, or should an additional detector be offered?
2) Which categories and image conditions can the initial release actually support?
3) What measured scan budget and latency are acceptable?
4) Is manual confirmation fast enough, or does candidate selection need improvement?

These questions do not block camera, local data, overlay, or archive work. They do block promises of automatic complete inventory.

## PRD-SEC-010 — Future expansions

1) **Where did I last see …?** Search items and dated observations.
2) Encrypted exports and optional multi-device synchronization.
3) Multiple homes, household sharing, and permissions.
4) Receipts, serial numbers, and user-supplied value without guarantees of insurance coverage.
5) Local reference/current image registration with an explicit alignment-quality measure.
6) Optional QR labels or other identifiers for visually identical belongings.
7) Continuous tracking or spatial mapping after a separate feasibility evaluation.

## Developer handoff

Start with Phase 0. Keep clear module boundaries for camera, overlays, inventory, observations, matching, comparisons, persistence, archive, providers, and i18n. Preserve feature IDs in tasks and tests.

Create a complete fixture-driven demo with two rooms, two living-room viewpoints, one item appearing in both views, two identical cups, one moved item, and one hidden item. Fixtures must include ground truth and be visibly labeled **Demo**. Add the JEV adapter only through the verified provider contract. Do not infer API payloads from unverified third-party examples.

The first review should demonstrate room selection, capture, identity decisions, revisit overlay, comparison, export/import, and same-device session URLs as one connected flow. Working data relationships and query string state preservation matter more than many disconnected screens.

**All UI strings** must be externalized and translated to Danish, English, Spanish, and Simplified Chinese using a typed i18n system. **All code, comments, documentation, error messages, and developer-facing text** remain in English.

**Typography**: Apply the specified font stack (`Avenir, Montserrat, Corbel, 'URW Gothic', source-sans-pro, sans-serif` with `font-weight: normal`) as the application default. Use monospace fonts only for technical content.

## Sources and research status

Research date: 19 October 2026. Confirmed product decisions come from the discussion with Sten. Stack, limits, and evaluation targets are recommendations. This revision (v1.3) replaces static SPA deployment with SvelteKit on a server host (Netlify since 20 October 2026) (the provider proxy needs a server route) and scopes session URLs to the same device. v1.2 added WebGL shaders for overlay blending, query string state persistence, i18n support for UI (Danish, English, Spanish, Simplified Chinese), and specified typography while preserving all feature IDs and scenarios.

1) TypeSafe AI, **Jev: For the builders AND dreamers**, 14 October 2026: https://typesafe.ai/blog/jev-1-14
2) MDN, **getUserMedia**: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
3) MDN, **IndexedDB**: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
4) MDN, **Storage quotas and eviction criteria**: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
5) Official JEV documentation entry points linked by the release announcement; not directly readable during research: https://docs.typesafe.ai/go/images and https://docs.typesafe.ai/go/box
