# JEV contract (verified 2026-10-19)

This is the provider contract HomeTrace builds on. It comes from official docs only and was
confirmed against live responses. Only `src/lib/providers/jev/` may depend on it. Images and the
Box question are a TypeSafe **preview**: the format, answers and limits can change between
releases. Check the sources again before relying on anything here.

## Sources

- OpenRouter, Jev guide: https://openrouter.ai/docs/guides/community/jev
- OpenRouter, Multimodal Decisions: https://openrouter.ai/docs/guides/community/multimodal-decisions
- TypeSafe, Box: https://docs.typesafe.ai/primitives/box
- TypeSafe, Images: https://docs.typesafe.ai/images
- TypeSafe, release notes: https://typesafe.ai/blog/jev-1-14

## Access

| Item | Value |
| --- | --- |
| Endpoint | `POST https://openrouter.ai/api/alpha/decisions` (OpenRouter Decisions API) |
| Auth | `Authorization: Bearer $OPEN_ROUTER_API_KEY`. No TypeSafe account needed |
| Model | `typesafe/jev-1.14`, pinned. Box needs 1.14; 1.13 rejects it with a 400. `~typesafe/jev-latest` moves |
| Not this | Chat Completions, and `typesafe/jev-router`, which is a different product |
| Image header | `TypeSafe-Danger-Zone-Images` is required on TypeSafe's own API. Through OpenRouter, live requests succeeded without it (2026-10-19). OpenRouter does not document it |

## Request

```json
{
  "model": "typesafe/jev-1.14",
  "state": ["Photo of part of a room in a home:", { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }],
  "questions": {
    "present__lamp__0": { "type": "noul", "instructions": "A lamp is clearly visible in the photo." },
    "box__lamp__0": { "type": "box", "instructions": "the lamp in the photo" }
  }
}
```

- Put images in the `state` array as base64 data URLs. Only `image/png` and `image/jpeg` are accepted. Remote URLs are not fetched.
- Text items in `state` are plain strings.
- Every question in a request is answered against the same state, and the image is sent once.

## Answers

| Type | Shape | Notes |
| --- | --- | --- |
| `box` | `{ "box": { "top", "bottom", "left", "right" }, "confidence" }` | See the Box notes below |
| `noul` | `{ "noul": 0.93 }` | Probability of yes. No `confidence` field |
| `choice` | `{ "choice", "probabilities", "confidence" }` | `criteria` keys are the options |

Box answers:

- Edges are fractions 0..1 from the top-left corner. Convert them to `{x, y, width, height}`.
- **One box per question. There is no "not found" answer**: a Box about something absent still returns four edges. Always pair a Box with a Noul presence check.
- `confidence` may be missing; it then stays `null`. There is no recommended threshold.

Every response includes `usage.input_tokens`, `usage.output_tokens` and `usage.cost` (USD).

## Limits

- Each side must be 280 to 1568 px, and the total 78,400 to 2,458,624 px. OpenRouter says 256 px minimum and TypeSafe says 280 px, so use 280.
- 16 MiB per image. TypeSafe caps the request body at 32 MiB.
- **EXIF orientation is not applied.** Rotate the pixels yourself. Images are never resized to fit.
- Every request with an image runs in TypeSafe's long-context mode, which TypeSafe calls slower and less accurate.
- Rate limits are per account and not published. The TypeSafe SDKs retry by default. HomeTrace uses plain `fetch` and never retries.

## Price and privacy

- **Price:** input tokens at $0.042 per million. Output tokens are free. Images count as input tokens, and there is no published formula for image tokens yet.
- **Privacy:** TypeSafe states it does not train on prompts or inputs. Retention periods for API inputs are **not documented**. Zero data retention exists for enterprise customers only.
- **Before a public pilot or real household photos beyond private testing,** verify the terms again (PRD-SEC-007.11).

## Measured on Demo fixtures, 2026-10-19

These are four synthetic drawings in `fixtures/demo`, not photos. The results show that the contract and pipeline work. They say nothing about real homes.

| Run | Requests | Cost | Precision | Recall | Notes |
| --- | --- | --- | --- | --- | --- |
| Count, then locate with position words | 8 | $0.0013 | 84 % | 84 % | "the second / rightmost cup" returned the **first** cup again |
| Count, then locate, with strips for repeated categories | 14 | $0.0017 | 94 % | 89 % | Both cups found; repeated-instance failures 1 → 0 |
| Identity, 10 crop pairs (5 same, 5 different lookalikes) | 10 | $0.0004 | | | All 5 same pairs: possible same. **3 of 5 lookalike pairs also judged "possible same"** (noul 0.77–0.88) |

Latency: about 0.3–0.7 s per request; 0.6–2.7 s per image job.

Conclusions so far:

1. **JEV cannot enumerate unknown objects.** HomeTrace asks about a bounded list of categories (`DEFAULT_CATEGORIES`). Items outside that list are only found by manual marking.
2. **Repeated instances need region splitting.** Position words do not work.
3. **Identity cannot tell lookalikes apart** on these drawings. The user must confirm every match, as the PRD already requires. Real photos with wear and context may do better; measure it.
