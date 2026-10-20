# Vision-LLM detector contract (verified 2026-10-20)

This is a second discovery provider for Phase 0, answering PRD-SEC-009 question 1: is JEV alone
enough, or should an extra detector be offered? Only `src/lib/providers/vision/` depends on this
contract.

## Why

JEV has no list-of-boxes answer and cannot find objects it is not asked about
(see [jev-contract.md](jev-contract.md)). A vision-language model can list every visible object
with a box in one call.

## Sources

- Qwen3-VL 2D grounding cookbook: https://github.com/QwenLM/Qwen3-VL/blob/main/cookbooks/2d_grounding.ipynb
  > "Qwen3-VL's default coordinate system has been changed from the absolute coordinates used in Qwen2.5-VL to relative coordinates ranging from 0 to 1000."

  The cookbook output looks like `{"bbox_2d": [x1, y1, x2, y2], "label": "..."}`.
- Gemini image understanding: https://ai.google.dev/gemini-api/docs/image-understanding
  > "The box_2d should be [ymin, xmin, ymax, xmax] normalized to 0-1000."
- OpenRouter structured outputs: https://openrouter.ai/docs/features/structured-outputs. Use `response_format: { type: 'json_schema', json_schema: { name, strict, schema } }`.
- OpenRouter image parts: the Multimodal Decisions guide states that the image part is "the same image part Chat Completions uses": `{ "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }`.

## Contract

| Item | Value |
| --- | --- |
| Endpoint | `POST https://openrouter.ai/api/v1/chat/completions` |
| Auth | `Authorization: Bearer $OPEN_ROUTER_API_KEY`, the same key as JEV |
| Default model | `qwen/qwen3-vl-235b-a22b-instruct`. Override with `VISION_MODEL` |
| Allowed families | Only `qwen/qwen3-vl-*` and `google/gemini-*`, the families with a verified coordinate convention. Qwen2.5-VL uses absolute pixels and is refused |
| Output | JSON constrained by a JSON schema, `temperature: 0`. Every entry is validated. Invalid boxes are rejected, not repaired |
| Confidence | None. `providerConfidence` stays `null` |
| Usage | `usage.prompt_tokens`, `usage.completion_tokens` and `usage.cost` were present in live responses. They are treated as optional |

## Providers in `npm run eval`

| Provider | Discovery | Presence check | Identity |
| --- | --- | --- | --- |
| `jev` | JEV count, locate, then strips | JEV Noul | JEV Noul |
| `vision` | Vision-LLM, one call | None: all boxes are `uncertain` | Vision-LLM same / different / unsure |
| `vision-jev` | Vision-LLM, one call | JEV Noul per crop, one batched call | JEV Noul |

## Measured on Demo fixtures, 2026-10-20

The fixtures are four synthetic drawings, not photos. The results only show that the contract and pipeline work.

| Provider | Detection requests | Detection cost | Precision | Recall | Latency per image |
| --- | --- | --- | --- | --- | --- |
| `jev` (with strips) | 14 | $0.0017 | 94 % | 89 % | 0.6–2.7 s |
| `vision` (Qwen3-VL) | 4 | $0.0029 | 100 % | 100 % | 8–21 s |
| `vision-jev` | 8 | $0.0029 | 100 % | 100 % | 3.4–20 s |

Identity on 10 crop pairs (5 same, 5 lookalikes):

- **Qwen3-VL** answered "unsure" on all 10 pairs. That is safe, but it does not help the user.
- **JEV** proposed "same" for all 5 true pairs and for 3 of the 5 lookalikes. That is helpful as a proposal, but it is never proof.

Observations:

1. **The vision-LLM finds everything without a category list.** That includes repeated cups, with no strips needed. Real photos must confirm this.
2. **It is 5–10× slower than JEV,** which matters on the phone after pressing Scan.
3. **JEV as a checker is cheap and fast** (about $0.0001 and 0.3–0.5 s per image) and adds a presence signal the vision-LLM lacks.
4. **Privacy:** images go to an additional model provider behind OpenRouter. Check the model's data policy on its OpenRouter page before sending real household photos.
