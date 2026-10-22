# AI accuracy

Twenty fictional WhatsApp orders (`tests/fixtures/ai-accuracy/order-01.json` to `order-20.json`) are read by Gemini through the production adapter and prompt, with personal data redacted first. Run `pnpm ai:accuracy -- --model <name>` (live; needs `GEMINI_API_KEY`; not part of `pnpm test`). An order is correct when every expected line matches by product and quantity, ambiguous lines offer the listed products, and no extra products are matched. A returned id outside the catalogue is invented. A failed call counts as not correct. Expectations were written from the catalogue, not tuned to the model.

## Decision (D6)

Chosen model: **gemini-3.5-flash-lite** (the existing default, confirmed). Bar: at least 18/20 and 0 invented ids. Rule for the cheaper candidate: gemini-3.1-flash-lite replaces it only if a run scores at least 18/20 with 0 invented ids AND 0 timeouts or unavailable errors, because under the 15-second budget those reach users as AI_UNAVAILABLE.

| Model                        | Correct | Invented ids | Errors | Qualifies | Input / 1M tokens | Output / 1M tokens |
| ---------------------------- | ------- | ------------ | ------ | --------- | ----------------- | ------------------ |
| gemini-3.5-flash-lite        | 19/20   | 0            | 0      | yes       | $0.30             | $2.50              |
| gemini-3.1-flash-lite, run 1 | 14/20   | 0            | 5      | no        | $0.25             | $1.50              |
| gemini-3.1-flash-lite, rerun | 17/20   | 0            | 2      | no        | $0.25             | $1.50              |
| gemini-3.5-flash             | not run | -            | -      | -         | not listed        | not listed         |

3.1-flash-lite is cheaper but failed twice: run 1 had 5 timeouts or unavailable answers; the rerun had 2 errors (orders 13 and 17) and 17/20 correct. In both runs it read "susu pekat 96 tin" as 96 cartons (order-15). Its errors are the "unavailable" or "took too long" kind, so it cannot be relied on within the budget. 3.5-flash-lite is the only qualifier, so `gemini-3.5-flash` was not run. Its one miss is order-09: "teh 20 pek" and "kopi 30 pek" were read as 20 and 30 cartons instead of converting packs (10 pack = 1 carton). Owners should still confirm quantities in the review screen.

Pricing (standard paid tier, USD per 1M tokens, text): https://ai.google.dev/gemini-api/docs/pricing , read 22 Oct 2026. `gemini-3.5-flash` is not on that page.

<!-- run:gemini-3.5-flash-lite -->

## Run: gemini-3.5-flash-lite

Date: 22 Oct 2026, 12:20 MYT

Result: **19/20 correct, 0 invented ids, 0 errors** - qualifies (bar: at least 18/20 and 0 invented ids).

| Order    | Result | Problems                                                                                                 | Model read                                                                                                 |
| -------- | ------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| order-01 | pass   | -                                                                                                        | CM x5; OIL x3; FLOUR x2                                                                                    |
| order-02 | pass   | -                                                                                                        | CM x4; COFFEE x2; TEA x1; OIL x2                                                                           |
| order-03 | pass   | -                                                                                                        | EM x3; BAGS x2; CONT x1                                                                                    |
| order-04 | pass   | -                                                                                                        | EM x2; EGG_B x5; KRAFT x1; CUPS x3                                                                         |
| order-05 | pass   | -                                                                                                        | CM x3; OIL x2; FLOUR x1; COFFEE x1                                                                         |
| order-06 | pass   | -                                                                                                        | CONT x2; BAGS x1; EGG_A x4; EM x2                                                                          |
| order-07 | pass   | -                                                                                                        | CM x4; OIL x2; EGG_B x6; TEA x1                                                                            |
| order-08 | pass   | -                                                                                                        | CM x2; EM x3; OIL x4; EGG_A x8                                                                             |
| order-09 | FAIL   | missing or wrong: TEA x2; missing or wrong: COFFEE x3; extra product: TEA x20; extra product: COFFEE x30 | TEA x20; COFFEE x30; CUPS x2; KRAFT x1                                                                     |
| order-10 | pass   | -                                                                                                        | CM x2; EGG_B x5; EM x3; OIL x1                                                                             |
| order-11 | pass   | -                                                                                                        | CM x3; OIL x2                                                                                              |
| order-12 | pass   | -                                                                                                        | null x2; CM x3; OIL x1                                                                                     |
| order-13 | pass   | -                                                                                                        | null x1; FLOUR x2; COFFEE x1                                                                               |
| order-14 | pass   | -                                                                                                        | EGG_A x5; EM x2                                                                                            |
| order-15 | pass   | -                                                                                                        | CM x2; OIL x2                                                                                              |
| order-16 | pass   | -                                                                                                        | CM x3; OIL x2; FLOUR x1; COFFEE x2                                                                         |
| order-17 | pass   | -                                                                                                        | CM x2; EM x3; OIL x4; FLOUR x1; COFFEE x2; TEA x1; EGG_A x6; EGG_B x4; CUPS x2; CONT x3; BAGS x1; KRAFT x2 |
| order-18 | pass   | -                                                                                                        | CM x3; EM x2; OIL x5; FLOUR x3; COFFEE x2; BAGS x1; CONT x2                                                |
| order-19 | pass   | -                                                                                                        | CM x4; EM x2; OIL x3; FLOUR x2                                                                             |
| order-20 | pass   | -                                                                                                        | CM x6; OIL x2; EGG_A x10; COFFEE x1; CUPS x2                                                               |

<!-- /run:gemini-3.5-flash-lite -->

<!-- run:gemini-3.1-flash-lite-1 -->

## Run: gemini-3.1-flash-lite (first run)

Date: 22 Oct 2026, 12:23 MYT

Result: **14/20 correct, 0 invented ids, 5 errors** - does not qualify (bar: at least 18/20 and 0 invented ids).

| Order    | Result | Problems                                       | Model read                           |
| -------- | ------ | ---------------------------------------------- | ------------------------------------ |
| order-01 | pass   | -                                              | CM x5; OIL x3; FLOUR x2              |
| order-02 | pass   | -                                              | CM x4; COFFEE x2; TEA x1; OIL x2     |
| order-03 | pass   | -                                              | EM x3; BAGS x2; CONT x1              |
| order-04 | pass   | -                                              | EM x2; EGG_B x5; KRAFT x1; CUPS x3   |
| order-05 | pass   | -                                              | CM x3; OIL x2; FLOUR x1; COFFEE x1   |
| order-06 | pass   | -                                              | CONT x2; BAGS x1; EGG_A x4; EM x2    |
| order-07 | error  | The assistant is unavailable right now.        | -                                    |
| order-08 | pass   | -                                              | CM x2; EM x3; OIL x4; EGG_A x8       |
| order-09 | pass   | -                                              | TEA x2; COFFEE x3; CUPS x2; KRAFT x1 |
| order-10 | pass   | -                                              | CM x2; EGG_B x5; EM x3; OIL x1       |
| order-11 | pass   | -                                              | CM x3; OIL x2                        |
| order-12 | pass   | -                                              | null x2; CM x3; OIL x1               |
| order-13 | error  | The assistant is unavailable right now.        | -                                    |
| order-14 | pass   | -                                              | EGG_A x5; EM x2                      |
| order-15 | FAIL   | missing or wrong: CM x2; extra product: CM x96 | CM x96; OIL x2                       |
| order-16 | pass   | -                                              | CM x3; OIL x2; FLOUR x1; COFFEE x2   |
| order-17 | error  | The assistant took too long to answer.         | -                                    |
| order-18 | error  | The assistant took too long to answer.         | -                                    |
| order-19 | pass   | -                                              | CM x4; EM x2; OIL x3; FLOUR x2       |
| order-20 | error  | The assistant took too long to answer.         | -                                    |

<!-- /run:gemini-3.1-flash-lite-1 -->

<!-- run:gemini-3.1-flash-lite -->

## Run: gemini-3.1-flash-lite (rerun)

Date: 22 Oct 2026, 12:29 MYT

Result: **17/20 correct, 0 invented ids, 2 errors** - does not qualify (bar: at least 18/20 and 0 invented ids).

| Order    | Result | Problems                                       | Model read                                                  |
| -------- | ------ | ---------------------------------------------- | ----------------------------------------------------------- |
| order-01 | pass   | -                                              | CM x5; OIL x3; FLOUR x2                                     |
| order-02 | pass   | -                                              | CM x4; COFFEE x2; TEA x1; OIL x2                            |
| order-03 | pass   | -                                              | EM x3; BAGS x2; CONT x1                                     |
| order-04 | pass   | -                                              | EM x2; EGG_B x5; KRAFT x1; CUPS x3                          |
| order-05 | pass   | -                                              | CM x3; OIL x2; FLOUR x1; COFFEE x1                          |
| order-06 | pass   | -                                              | CONT x2; BAGS x1; EGG_A x4; EM x2                           |
| order-07 | pass   | -                                              | CM x4; OIL x2; EGG_B x6; TEA x1                             |
| order-08 | pass   | -                                              | CM x2; EM x3; OIL x4; EGG_A x8                              |
| order-09 | pass   | -                                              | TEA x2; COFFEE x3; CUPS x2; KRAFT x1                        |
| order-10 | pass   | -                                              | CM x2; EGG_B x5; EM x3; OIL x1                              |
| order-11 | pass   | -                                              | CM x3; OIL x2                                               |
| order-12 | pass   | -                                              | null x2; CM x3; OIL x1                                      |
| order-13 | error  | The assistant took too long to answer.         | -                                                           |
| order-14 | pass   | -                                              | EGG_A x5; EM x2                                             |
| order-15 | FAIL   | missing or wrong: CM x2; extra product: CM x96 | CM x96; OIL x2                                              |
| order-16 | pass   | -                                              | CM x3; OIL x2; FLOUR x1; COFFEE x2                          |
| order-17 | error  | The assistant took too long to answer.         | -                                                           |
| order-18 | pass   | -                                              | CM x3; EM x2; OIL x5; FLOUR x3; COFFEE x2; BAGS x1; CONT x2 |
| order-19 | pass   | -                                              | CM x4; EM x2; OIL x3; FLOUR x2                              |
| order-20 | pass   | -                                              | CM x6; OIL x2; EGG_A x10; COFFEE x1; CUPS x2                |

<!-- /run:gemini-3.1-flash-lite -->
