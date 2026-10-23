# Kongsi Engine API v1

The Kongsi Engine is BeliKongsi's pricing and settlement maths, offered as a public, stateless HTTP API. Give it a tier ladder and a list of participations and it answers with exact amounts in whole sen. Every amount is an integer number of sen (1 RM = 100 sen), and every field that holds money ends in `Sen`.

**No data is stored.** There is no session, no sign-in and no database behind these endpoints. Each request is computed from its own body and forgotten. The same body always gives the same answer.

## Versioning

The version is part of the path: `/api/engine/v1/...`. A change that breaks a request or response shape ships under a new version path (`v2`); `v1` keeps its shapes.

All three endpoints take `POST` with a JSON body (`Content-Type: application/json`).

| Endpoint                                 | Purpose                                                     |
| ---------------------------------------- | ----------------------------------------------------------- |
| `POST /api/engine/v1/quote`              | What a buyer pays now, and what they pay if the round fills |
| `POST /api/engine/v1/close-round`        | Settle a round at cut-off: final tier, who is kept, refunds |
| `POST /api/engine/v1/allocate-shortfall` | Share out good units when fewer arrive than were ordered    |

## The `X-Orbyte-App-Id` header

Send an optional `X-Orbyte-App-Id` header to say which app is calling, for example `X-Orbyte-App-Id: kedai-pos`. It is not a secret and does not change the answer. When present, the server logs `[engine-api] app=<id> op=<operation>`, with control characters removed and the id cut to its first 64 characters.

## Quote

`POST /api/engine/v1/quote`

`unitName` is optional and defaults to `unit`. `priceLimitSen` is optional. `currentRoundTotal` is the number of units already in the round, not counting `quantity`.

Request:

```json
{
  "tiers": [
    {
      "minQuantity": 20,
      "unitPriceSen": 15800
    },
    {
      "minQuantity": 50,
      "unitPriceSen": 15200
    },
    {
      "minQuantity": 100,
      "unitPriceSen": 14600
    }
  ],
  "feeBps": 200,
  "unitShippingSen": 293,
  "quantity": 6,
  "currentRoundTotal": 99,
  "unitName": "carton"
}
```

Response (200):

```json
{
  "starting": {
    "goodsSen": 15800,
    "feeSen": 316,
    "shippingSen": 293,
    "allInSen": 16409
  },
  "startingLineSen": 98454,
  "withoutYou": {
    "total": 99,
    "tier": 2,
    "amounts": {
      "goodsSen": 15200,
      "feeSen": 304,
      "shippingSen": 293,
      "allInSen": 15797
    },
    "unitsToNextTier": 1,
    "nextTier": {
      "position": 3,
      "minQuantity": 100,
      "unitPriceSen": 14600
    }
  },
  "withYou": {
    "total": 105,
    "tier": 3,
    "amounts": {
      "goodsSen": 14600,
      "feeSen": 292,
      "shippingSen": 293,
      "allInSen": 15185
    },
    "unitsToNextTier": null,
    "nextTier": null
  },
  "limit": null,
  "explanation": [
    "You pay RM 164.09 a carton now: the starting price. Anything above the final price comes back to your balance at cut-off.",
    "99 cartons so far. 1 more carton and everyone pays RM 146.00.",
    "Your 6 cartons take it to 105: the RM 146.00 tier.",
    "Your all-in price: RM 151.85 (RM 146.00 goods + RM 2.92 BeliKongsi fee + RM 2.93 shipping)."
  ]
}
```

Try it:

```bash
curl -X POST http://localhost:3000/api/engine/v1/quote   -H "Content-Type: application/json"   -H "X-Orbyte-App-Id: kedai-pos"   -d '{"tiers":[{"minQuantity":20,"unitPriceSen":15800},{"minQuantity":50,"unitPriceSen":15200},{"minQuantity":100,"unitPriceSen":14600}],"feeBps":200,"unitShippingSen":293,"quantity":6,"currentRoundTotal":99,"unitName":"carton"}'
```

## Close a round

`POST /api/engine/v1/close-round`

Each participant carries a caller-chosen `reference` (any unique, non-empty string of up to 200 characters). `joinedAt` is an ISO 8601 date-time that ends in `Z` or a UTC offset, such as `2026-11-01T22:03:00Z` or `2026-11-02T06:03:00+08:00`. A time without an offset is rejected, because it would depend on the server's time zone. Two times written differently that name the same instant tie, and the tie is broken by `reference`. `tiers` holds at most 5 tiers, and `reference`, `joinedAt` and `unitName` are at most 200 characters. Unknown keys are rejected. `priceLimitSen` is optional (`null` or absent means no limit). `unitName` is optional and defaults to `unit`. The response uses the same `reference` for each participant.

The example is a Grade B egg round with ten background buyers and one buyer ("kafe") whose price limit is below the final price.

Request (trimmed to two of the eleven participants):

```json
{
  "tiers": [
    {
      "minQuantity": 100,
      "unitPriceSen": 1170
    },
    {
      "minQuantity": 300,
      "unitPriceSen": 1130
    },
    {
      "minQuantity": 600,
      "unitPriceSen": 1090
    }
  ],
  "feeBps": 200,
  "unitName": "tray",
  "participants": [
    {
      "reference": "egg1",
      "quantity": 20,
      "joinedAt": "2026-10-31T00:00:00Z",
      "unitShippingSen": 40,
      "priceLimitSen": null,
      "paidSen": 24660
    },
    {
      "reference": "kafe",
      "quantity": 10,
      "joinedAt": "2026-11-01T22:03:00Z",
      "unitShippingSen": 40,
      "priceLimitSen": 1220,
      "paidSen": 12330
    }
  ]
}
```

Response (200, trimmed to the same two participants):

```json
{
  "status": "formed",
  "finalTier": 1,
  "finalUnitPriceSen": 1170,
  "iterations": 2,
  "totalAtCutoff": 130,
  "totalKept": 120,
  "participants": [
    {
      "reference": "egg1",
      "outcome": "kept",
      "final": {
        "goodsSen": 1170,
        "feeSen": 23,
        "shippingSen": 40,
        "allInSen": 1233
      },
      "finalLineSen": 24660,
      "refundSen": 0,
      "reason": "Kept at tier 1: RM 12.33 all-in. No refund: you paid the final price."
    },
    {
      "reference": "kafe",
      "outcome": "dropped_price_limit",
      "final": {
        "goodsSen": 1170,
        "feeSen": 23,
        "shippingSen": 40,
        "allInSen": 1233
      },
      "finalLineSen": 0,
      "refundSen": 12330,
      "reason": "Dropped: the final all-in price of RM 12.33 is above your limit of RM 12.20. Full refund: RM 123.30."
    }
  ],
  "totals": {
    "paidSen": 160290,
    "refundSen": 12330,
    "keptSen": 147960
  }
}
```

Try it. This is the trimmed request above: with only two participants the Kongsi stays under 100 trays, so it answers `"status": "failed"` with full refunds. List all eleven participants to see the example response.

```bash
curl -X POST http://localhost:3000/api/engine/v1/close-round   -H "Content-Type: application/json"   -d '{"tiers":[{"minQuantity":100,"unitPriceSen":1170},{"minQuantity":300,"unitPriceSen":1130},{"minQuantity":600,"unitPriceSen":1090}],"feeBps":200,"unitName":"tray","participants":[{"reference":"egg1","quantity":20,"joinedAt":"2026-10-31T00:00:00Z","unitShippingSen":40,"priceLimitSen":null,"paidSen":24660},{"reference":"kafe","quantity":10,"joinedAt":"2026-11-01T22:03:00Z","unitShippingSen":40,"priceLimitSen":1220,"paidSen":12330}]}'
```

## Allocate a shortfall

`POST /api/engine/v1/allocate-shortfall`

Use this when fewer good units arrive than were ordered. `kept[]` lists the kept participations, with the `final` amounts from the close-round response. Units go first come, first served by `joinedAt` (an ISO 8601 date-time with `Z` or a UTC offset; ties broken by `reference`); the last joiners take the shortfall and are refunded.

Request (trimmed to the first and last of the nine kept participations; a real call lists all of them):

```json
{
  "kept": [
    {
      "reference": "bg1",
      "quantity": 20,
      "joinedAt": "2026-10-30T01:00:00Z",
      "final": {
        "goodsSen": 14600,
        "feeSen": 292,
        "shippingSen": 293,
        "allInSen": 15185
      }
    },
    {
      "reference": "kedai",
      "quantity": 6,
      "joinedAt": "2026-11-01T22:05:00Z",
      "final": {
        "goodsSen": 14600,
        "feeSen": 292,
        "shippingSen": 293,
        "allInSen": 15185
      }
    }
  ],
  "goodUnitsReceived": 100,
  "finalGoodsPriceSen": 14600
}
```

Response (200, trimmed to the same two allocations):

```json
{
  "allocations": [
    {
      "reference": "bg1",
      "allocated": 20,
      "missing": 0,
      "refundSen": 0
    },
    {
      "reference": "kedai",
      "allocated": 1,
      "missing": 5,
      "refundSen": 75925
    }
  ],
  "orderedQuantity": 105,
  "receivedCounted": 100,
  "excessUnits": 0,
  "excessFlag": false,
  "supplierPayableSen": 1460000,
  "feeRevenueSen": 29200,
  "logisticsPayableSen": 32958,
  "shortfallRefundSen": 75925
}
```

Try it. This is the trimmed request above: with only two kept participations (26 units ordered), the 100 good units cover the order, so nothing is short and `excessFlag` is true. List every kept participation to see the example response.

```bash
curl -X POST http://localhost:3000/api/engine/v1/allocate-shortfall   -H "Content-Type: application/json"   -d '{"kept":[{"reference":"bg1","quantity":20,"joinedAt":"2026-10-30T01:00:00Z","final":{"goodsSen":14600,"feeSen":292,"shippingSen":293,"allInSen":15185}},{"reference":"kedai","quantity":6,"joinedAt":"2026-11-01T22:05:00Z","final":{"goodsSen":14600,"feeSen":292,"shippingSen":293,"allInSen":15185}}],"goodUnitsReceived":100,"finalGoodsPriceSen":14600}'
```

## Limits

So that every amount stays an exact whole number, inputs are bounded. Anything above a limit gets a 422:

- Money fields (every field ending in `Sen`, including tier prices, shipping, price limits, `paidSen` and the `final` amounts): at most 10,000,000 sen (RM 100,000).
- Quantities (`minQuantity`, `quantity`, `currentRoundTotal`, `goodUnitsReceived`): at most 100,000.
- `participants` and `kept`: at most 5,000 entries.

## Errors

### The error format

Every error from every BeliKongsi API, including these three routes, is JSON with the same shape: `code` (a stable machine-readable string), `message` (plain English) and an optional `details`. The status code says what kind of problem it is:

| Status | Meaning                   |
| ------ | ------------------------- |
| 400    | invalid input             |
| 401    | no session                |
| 403    | role not allowed          |
| 404    | not visible to the caller |
| 409    | state conflict            |
| 422    | business rule broken      |
| 429    | rate limited              |
| 503    | AI unavailable            |

The Engine API is public, so in practice it returns only 400 and 422, described below.

### 422: some fields are not valid

Bad input never causes a 500. Every problem is listed in one response, whether it was caught by the request shape check or by the engine's own rules (for example tiers whose prices do not strictly decrease). This request has a string where a number belongs and three missing fields:

```json
{
  "code": "INVALID_ENGINE_INPUT",
  "message": "Some fields are not valid.",
  "details": {
    "fields": [
      {
        "path": "tiers[1].minQuantity",
        "message": "Invalid input: expected number, received string"
      },
      {
        "path": "unitShippingSen",
        "message": "Invalid input: expected number, received undefined"
      },
      {
        "path": "quantity",
        "message": "Invalid input: expected number, received undefined"
      },
      {
        "path": "currentRoundTotal",
        "message": "Invalid input: expected number, received undefined"
      }
    ]
  }
}
```

`path` locates the field: `tiers[1].minQuantity` is the `minQuantity` of the second tier (indexes start at 0). A problem with the whole body has the path `""`. Numbers must be JSON numbers; a string such as `"20"` is rejected, not converted. Paths line up with the request, including the engine's own rules: a duplicate or empty `reference` is reported at `participants[1].reference` (in `allocate-shortfall`, at `kept[1].reference`). Bodies are strict: an unknown key is rejected, with the path of the key itself (for example `participants[0].priceLimitsen`), so a typo never silently drops a rule such as the price limit.

### 400: malformed JSON

A body that is not valid JSON gets a 400:

```json
{
  "code": "INVALID_INPUT",
  "message": "The request body must be valid JSON."
}
```

## Notes for operators

- These routes are public by design. The same-origin check that M2 adds must exempt `/api/engine/v1/*`, so other apps can call them from their own origins.
