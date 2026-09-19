# Independent Quotation Desk — Column and Formula Specification

Status: Working draft v0.1  
Date: 2026-09-19

## Frozen workflow decisions

- One customer has one independent QD Google Sheet file.
- Catalogue `SELECT` creates the Wix My Selection record and an RFQ immediately.
- Every new QD line starts with `QUOTE STATUS = RFQ`.
- Sales staff change only the lines they want to release to `VIEW QUOTE`, then run `SYNC QUOTATION TO WIX`.
- Successful lines remain `VIEW QUOTE`; failed lines become `FAILED`; untouched lines remain `RFQ`.
- Sales Room notification count is `RFQ + FAILED`.
- Wix is the source of truth for selection, quotation visibility, order submission and audit history.
- QD file identity is validated with Google File ID and Customer ID. Each product row is linked by Wix My List ID.

## Customer block

| Field | Owner | Rule |
|---|---|---|
| Customer Name | Wix | Script-written and protected |
| Customer ID | Wix | Script-written, protected, and validated against the QD File ID |
| Currency | Wix | Script-written and protected |
| FX Rate | Authoritative rate source | Numeric value used by quotation formulas; source and refresh rule must be frozen before build |

The Google File ID is read automatically from the active spreadsheet. It is not entered in a visible cell.

## Proposed main table

Header row: 5  
Data starts: row 6

| Col | Header | Type / owner | Working rule |
|---|---|---|---|
| A | COST HEALTH | Formula or system result | Compares the QD cost snapshot with the authoritative PointBase cost and cost date |
| B | QUOTE STATUS | Sales workflow | Dropdown: `RFQ`, `VIEW QUOTE`, `FAILED`; new Wix rows default to `RFQ` |
| C | UNIT BARCODE | Wix / PointBase | Protected text identifier; never store as a number |
| D | ITEM NAME | Wix / PointBase | Protected source value |
| E | PACKING SIZE | Wix / PointBase | Protected source value |
| F | EA | Wix / PointBase | Units per carton; positive whole number |
| G | LP /PC | PointBase snapshot | Numeric source value |
| H | LP /CTN | Formula or PointBase fallback | Normally `EA × LP /PC`; may retain an authoritative static carton price when supplied |
| I | DISC 1 | PointBase snapshot | Percentage |
| J | DISC 2 | PointBase snapshot | Percentage |
| K | DISC 3 | PointBase snapshot | Fixed MYR deduction per carton, not a percentage |
| L | NET COST /CTN | Formula | Sequential discounts applied to LP /CTN |
| M | QUOTE $/PC | Sales input | Positive quotation price in the customer's currency |
| N | QUOTE $/CTN | Formula | `EA × QUOTE $/PC` |
| O | PROFIT (MYR) | Formula | Customer-currency carton revenue converted to MYR less net carton cost |
| P | GP | Formula | Carton profit divided by carton revenue in MYR |
| Q | TARGET GP | Sales input | Percentage used only to calculate the reference price |
| R | REFRE. $/PC | Formula | Reference unit selling price required to achieve Target GP |
| S | SORT ID | Wix / PointBase | Protected stable catalogue sort value |
| T | WIX MY LIST ID | Wix | Protected row key used by QD-to-Wix sync |

## Working row formulas

The exact formula-row implementation will be frozen after confirming whether hybrid `LP /CTN` values remain required.

### H — LP /CTN

Normal case:

```gs
=IF(OR(F6="",G6=""),"",ROUND(F6*G6,2))
```

The legacy workflow allowed this column to contain either a formula or a static PointBase carton cost. The new CATCH COST script must preserve that distinction if it is still required.

### L — NET COST /CTN

```gs
=IF(H6="","",ROUND(H6*(1-N(I6))*(1-N(J6))-N(K6),2))
```

DISC 1 and DISC 2 are percentages. DISC 3 is a fixed MYR deduction per carton.

### N — QUOTE $/CTN

```gs
=IF(OR(F6="",M6=""),"",ROUND(F6*M6,2))
```

### O — PROFIT (MYR)

Assuming FX Rate is in `$D$4` and means MYR per unit of customer currency:

```gs
=IF(OR(N6="",L6="",$D$4=""),"",ROUND(N6*$D$4-L6,2))
```

### P — GP

```gs
=IF(OR(O6="",N6="",$D$4="",N6*$D$4=0),"",O6/(N6*$D$4))
```

### R — REFRE. $/PC

```gs
=IF(OR(L6="",F6="",$D$4="",Q6="",Q6>=1),"",ROUND((L6/(1-Q6))/$D$4/F6,2))
```

## Cost Health logic retained from the old QD

The supplied legacy formula reads these PointBase fields from FOOD, NONFOOD and OTHERS:

| PointBase field | Source column |
|---|---|
| Product Status | A |
| Cost Date | H |
| Unit Barcode | J |
| Net Cost | S |

It compares PointBase data with the QD row and returns:

- Black: product is `INACTIVE` or `DISCONTINUED`.
- Red: QD net cost is missing.
- Red: PointBase net cost is missing.
- Red: rounded QD net cost differs from rounded PointBase net cost.
- Red: PointBase cost date is missing or invalid.
- Green: cost age is 13 days or less.
- Orange: cost age is 14–30 days.
- Red: cost age is more than 30 days.

### Corrections required before reuse

1. Live inspection confirmed that the actual template already uses the correct literal-decimal regex `"\.0$"`. The earlier apparent `".0$"` came from pasted-text formatting and is not a defect in the live A6 formula.
2. Barcode columns in PointBase and QD must be plain text before data is written. Converting a barcode to text after Google Sheets has already rounded it cannot restore lost digits or leading zeroes.
3. `XLOOKUP` silently returns the first match when the same barcode appears more than once across FOOD, NONFOOD and OTHERS. The new design must detect duplicates and return a blocking red result instead of choosing one record.
4. The old live formula reads QD barcode from `C7:C3003` and QD Net Cost from `L7:L3003`, with A6 retained as the hidden spill-formula row.

## Independent-file scaling decision still to freeze

The old formula imports `A:S` from three 10,000-row PointBase tabs into every QD. That is approximately 570,000 imported source cells per customer QD before calculations. Repeating it across many independent customer files will be slow and difficult to maintain.

Preferred implementation:

1. Keep the Cost Health business rules above.
2. Let the central QD service read PointBase and refresh only the barcodes that exist in that customer's QD.
3. Store the compact result in protected hidden data or write the Cost Health result directly.
4. Do not give every independent QD three full `IMPORTRANGE` imports.

If live formula-only Cost Health is mandatory, PointBase should expose one compact, unique `QD COST LOOKUP` table containing only Status, Cost Date, Barcode and Net Cost. Each QD would then use one bounded import instead of three full-table imports.

## New WIX POINT BASE source layout

The new WIX POINT BASE is the future authority for product data and price data. Live inspection on 2026-09-19 confirmed that the three product tabs are not fully identical in columns C and E.

| Col | Header |
|---|---|
| A | STATUS |
| B | PRINCIPLE |
| C | FOOD: BRAND NAME; NONFOOD/OTHERS: COST FRESHNESS |
| D | COST VERIFIED ON |
| E | FOOD: COST FRESHNESS; NONFOOD/OTHERS: UPDATED IN |
| F | UNIT BARCODE |
| G | ITEM NAME |
| H | PACKING SIZE |
| I | EA |
| J | COST /PC |
| K | COST /CTN |
| L | DISC. 1 |
| M | DISC. 2 |
| N | DISC. 3 |
| O | NET COST /CTN |
| P | NOTES |
| Q | L (MM) |
| R | H (MM) |
| S | W (MM) |
| T | CBM /CTN |
| U | NET WEIGHT |
| V | COUNTRY ORIGIN |
| W | SHELF LIFE |
| X | CARTON BARCODE |
| Y | INNER BOX BARCODE |
| Z | SORT NO. |
| AA | WIX IMAGE URL |

### Cost Health source mapping change

The old QD formula cannot be reused unchanged. Its authoritative field positions change as follows:

| Purpose | Old source column | New WIX POINT BASE column |
|---|---:|---:|
| Product Status | A | A |
| Cost Verified Date | H | D |
| Cost Freshness | Calculated separately in each QD | FOOD E; NONFOOD/OTHERS C, owned by WIX POINT BASE |
| Unit Barcode | J | F |
| Net Cost /CTN | S | O |

FOOD, NONFOOD and OTHERS remain separate. Status is A, Cost Verified On is D, Unit Barcode is F and Net Cost /CTN is O on all three tabs. Cost Freshness is E on FOOD but C on NONFOOD and OTHERS, so the QD formula must map Freshness per tab rather than assume one identical header position.

### Recommended Cost Health v2 responsibility

WIX POINT BASE should calculate and own `COST FRESHNESS` once. Independent QDs should not each calculate `TODAY() - COST VERIFIED ON` against a full imported copy of the product database.

For each QD row, Cost Health v2 should evaluate in this order:

1. Blank QD barcode: blank result.
2. Barcode not found in WIX POINT BASE: red.
3. Barcode occurs more than once in the authoritative source: red and block release.
4. Source status is `INACTIVE` or `DISCONTINUED`: black and block release.
5. QD Net Cost or source Net Cost is missing: red and block release.
6. QD Net Cost differs from current source Net Cost after the agreed rounding rule: red and block release.
7. Source Cost Freshness is current: green.
8. Source Cost Freshness is warning: orange.
9. Source Cost Freshness is expired, missing or invalid: red and block release.

Before the production formula is frozen, confirm the exact allowed values and thresholds owned by `COST FRESHNESS`, whether the three category tabs remain, and whether `COST VERIFIED ON` is always a real Google Sheets date value.

## Sync safeguards

- `WIX MY LIST ID` is the only visible row-level Wix key required in QD.
- Customer ID is the visible file-level customer key.
- Google File ID is collected automatically at runtime.
- Wix must reject a row if File ID, Customer ID and Wix My List ID do not belong together.
- A `VIEW QUOTE` row with unchanged quotation values is skipped during later syncs.
- A changed `VIEW QUOTE` row creates a new Wix quotation version.
- A failed row becomes `FAILED`; correcting it and choosing `VIEW QUOTE` makes it eligible for retry.

## Interim A6 Cost Health formula for the live template

Live targets inspected on 2026-09-19:

- WIX POINT BASE: `12tyTIrmjF6JxMY-JW8K3JLuz5TcCkEjQUFXsauberLg`
- QUOTATION DESK - TEMPLATE: `1f2pT-KYlNTYT62ZAvHEqy0uVvV6rrnnmI_bmbVynpLU`
- Target tab and cell: `TEMPLATE!A6`
- Row 6 is the hidden spill-formula row; row 7 is the first QD product row.

```gs
=LET(
  PBID,"12tyTIrmjF6JxMY-JW8K3JLuz5TcCkEjQUFXsauberLg",

  PB_STATUS,
  VSTACK(
    IMPORTRANGE(PBID,"FOOD!A2:A10000"),
    IMPORTRANGE(PBID,"NONFOOD!A2:A10000"),
    IMPORTRANGE(PBID,"OTHERS!A2:A10000")
  ),

  PB_FRESHNESS,
  VSTACK(
    IMPORTRANGE(PBID,"FOOD!E2:E10000"),
    IMPORTRANGE(PBID,"NONFOOD!C2:C10000"),
    IMPORTRANGE(PBID,"OTHERS!C2:C10000")
  ),

  PB_BARCODE,
  VSTACK(
    IMPORTRANGE(PBID,"FOOD!F2:F10000"),
    IMPORTRANGE(PBID,"NONFOOD!F2:F10000"),
    IMPORTRANGE(PBID,"OTHERS!F2:F10000")
  ),

  PB_NET_COST,
  VSTACK(
    IMPORTRANGE(PBID,"FOOD!O2:O10000"),
    IMPORTRANGE(PBID,"NONFOOD!O2:O10000"),
    IMPORTRANGE(PBID,"OTHERS!O2:O10000")
  ),

  PB_BARCODE_KEY,
  ARRAYFORMULA(REGEXREPLACE(TRIM(PB_BARCODE&""),"\.0$","")),

  PB_STATUS_KEY,
  ARRAYFORMULA(UPPER(TRIM(PB_STATUS&""))),

  PB_FRESHNESS_KEY,
  ARRAYFORMULA(TRIM(PB_FRESHNESS&"")),

  PB_COST_KEY,
  ARRAYFORMULA(IFERROR(ROUND(VALUE(PB_NET_COST),2),"")),

  PB_COUNT_KEY,
  ARRAYFORMULA(COUNTIF(PB_BARCODE_KEY,PB_BARCODE_KEY)),

  VSTACK(
    "",
    MAP(
      C7:C3003,
      L7:L3003,
      LAMBDA(
        BARCODE,
        LOCAL_COST,
        IF(
          BARCODE="",
          "",
          LET(
            BKEY,REGEXREPLACE(TRIM(BARCODE&""),"\.0$",""),
            LKEY,IFERROR(ROUND(VALUE(LOCAL_COST),2),""),
            PB_COUNT,IFERROR(XLOOKUP(BKEY,PB_BARCODE_KEY,PB_COUNT_KEY,0),0),
            PB_PRODUCT_STATUS,IFERROR(XLOOKUP(BKEY,PB_BARCODE_KEY,PB_STATUS_KEY,""),""),
            PB_COST,IFERROR(XLOOKUP(BKEY,PB_BARCODE_KEY,PB_COST_KEY,""),""),
            PB_FRESHNESS_RESULT,IFERROR(XLOOKUP(BKEY,PB_BARCODE_KEY,PB_FRESHNESS_KEY,""),""),

            IF(
              PB_COUNT<>1,
              "🔴",
              IF(
                OR(PB_PRODUCT_STATUS="INACTIVE",PB_PRODUCT_STATUS="DISCONTINUED"),
                "⚫",
                IF(
                  PB_PRODUCT_STATUS<>"ACTIVE",
                  "🔴",
                  IF(
                    OR(LKEY="",PB_COST="",LKEY<>PB_COST),
                    "🔴",
                    IF(
                      OR(PB_FRESHNESS_RESULT="🟢",PB_FRESHNESS_RESULT="🟠",PB_FRESHNESS_RESULT="🔴"),
                      PB_FRESHNESS_RESULT,
                      "🔴"
                    )
                  )
                )
              )
            )
          )
        )
      )
    )
  )
)
```

This interim formula deliberately reads the source-owned freshness light. It also rejects missing and duplicate barcodes, blocks inactive/discontinued products, and checks that the QD Net Cost snapshot still equals WIX POINT BASE Net Cost /CTN.

### IMPORTRANGE authorization decision

Google requires every new destination spreadsheet to be explicitly connected to a source spreadsheet before `IMPORTRANGE` can read it. Copying the QD template creates a new destination and can therefore produce the `Allow access` prompt. There is no supported formula that clicks this prompt automatically.

The production QD creation workflow should avoid per-file IMPORTRANGE authorization. A centrally authorized Apps Script service should open WIX POINT BASE by file ID, read only the QD's selected barcodes, and write a protected local cache or the Cost Health results into the new QD. The administrator authorizes the central service once; sales staff do not authorize every customer QD.

