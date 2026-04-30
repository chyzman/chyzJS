# Time Expression Format

A compact syntax for expressing dates relative to now. Parsed by `TimeParser`.

---

## Expression syntax

```
<base> [@<time>] [<offsets>] [/<anchor>] [$] [[TZ]]
```

### Base

| Form | Meaning |
|------|---------|
| `^<anchor>` | Start of the current anchor period |
| `^N<anchor>` | Start of the Nth anchor period from now (`^1month` = next month, `^-1month` = last month) |
| `today` `yesterday` `tomorrow` | Named day constants |
| `now` or `~` | Current timestamp |
| `YYYY-MM-DD` | ISO date literal; also accepts `YYYY-MM-DDTHH:MM[:SS[.mmm]]` |
| `+<n><unit>` / `-<n><unit>` | Implicit base of now; e.g. `+1h` = 1 hour from now |

### Periods

Periods unify units (for offsets) and anchors (for `^` and `/`). A period with `step` is usable as a unit; one with `start` is usable as an anchor; most have both.

| Period | Names | Anchor? | Fixed ms? |
|--------|-------|---------|-----------|
| Millisecond | `ms` `millisecond` `milliseconds` | no | yes |
| Second | `s` `sec` `second` `seconds` | no | yes |
| Minute | `m` `min` `minute` `minutes` | no | yes |
| Hour | `h` `hr` `hour` `hours` | no | yes |
| Day | `d` `day` `days` | yes | yes |
| Week | `w` `week` `weeks` | yes | yes |
| Month | `mo` `month` `months` | yes | no |
| Quarter | `q` `quarter` `quarters` | yes | no |
| Year | `y` `yr` `year` `years` | yes | no |
| Weekday | `sun` `mon` `tue` `wed` `thu` `fri` `sat` (or full names) | yes | no |
| Business day | `bd` `bday` `bdays` `business day` `business days` | no | no |
| Business hour | `bh` `bhour` `bhours` `business hour` `business hours` | no | no |
| Fiscal year | `fy` `fiscal year` `fiscal-year` | yes | no |
| Fiscal quarter | `fq` `fiscal quarter` `fiscal-quarter` | yes | no |

Business and fiscal periods require including `BusinessPeriods` or `FiscalPeriods` in the plugin list.

### `@` - time-of-day override

Applied after all other operations.

```
today@14:30          → today at 14:30
^mon@09:00:00        → this Monday at 09:00:00
+1d@noon             → tomorrow at noon
```

Named times: `midnight` (00:00:00) · `noon` (12:00:00) · `eod` (23:59:59)

### Offsets

One or more `+<n><unit>` / `-<n><unit>` chains applied left to right.

```
today+3d             → 3 days from today
^month-1d            → day before start of this month
now-2h+30m           → 1.5 hours ago
+5bd                 → 5 business days from now
```

### `/` - snap to anchor

Floors the result to the start of a period. Applied after offsets, before `$`.

```
now/day              → start of today
+3d/week             → start of the week containing 3 days from now
```

### `$` - end of period

Snaps to the last millisecond of the active anchor (`/` anchor if present, base anchor otherwise, `day` as fallback).

```
^month$              → last ms of this month
^-1month$            → last ms of last month
+3d/week$            → last ms of the week 3 days from now
today$               → 23:59:59.999 today
```

### `[TZ]` - per-expression timezone

Appended at the end of an expression to override the timezone for that expression only.

```
now/day[America/New_York]    → start of today in New York
^month[Europe/London]$       → end of this month in London
```

---

## Range expressions

`parseRange()` accepts a start and end separated by `>`, ` - `, ` to `, or `..`.

```
^month > now         → [start of this month, now]
today..+7d           → [start of today, 7 days from now]
^month - ^month$     → [start of month, end of month]
```

A bare anchor/constant with no separator infers `[startOf, endOf]` automatically:

```
^month               → [start of month, end of month]
^week                → [start of week, end of week]
today                → [00:00:00 today, 23:59:59.999 today]
```

---

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tz` | `string` | local | IANA timezone for day boundary snapping |
| `weekStart` | `number` | `0` | First day of week: 0 = Sunday, 1 = Monday, … |
| `now` | `Date \| number` | `new Date()` | Pin "now" to a fixed value; useful for testing |
| `isHoliday` | `(d: Date) => boolean` | none | Returns true if a date is a holiday; used by `bd`/`bh` |
| `businessHoursStart` | `number` | `9` | Start of business day (hour 0–23); used by `bh` |
| `businessHoursEnd` | `number` | `17` | End of business day, exclusive (hour 0–23); used by `bh` |
| `fiscalYearStart` | `number` | `0` | Month index (0 = January) when the fiscal year starts; used by `fy`/`fq` |

Options can be set at three levels, each overriding the previous: plugin `defaults` → `TimeParser` constructor options → per-call options.

---

## Presets

| Export | Contents |
|--------|----------|
| `CorePeriods` | ms, second, minute, hour, day, week, month, quarter, year |
| `WeekdayPeriods` | sun, mon, tue, wed, thu, fri, sat |
| `BusinessPeriods` | bd, bh |
| `FiscalPeriods` | fy, fq |
| `CoreConstants` | now/~, today, yesterday, tomorrow |
| `CoreTimeNames` | midnight, noon, eod |
| `Standard` | `[CorePeriods, WeekdayPeriods, CoreConstants, CoreTimeNames]` |
| `Time` | `new TimeParser([...Standard, BusinessPeriods])` - default ready-to-use instance |

---

## API

```js
const parser = new TimeParser(plugins?, options?);

parser.parse(str, options?)               // → Date
parser.parseRange(str, options?)          // → [Date, Date]
parser.parseDuration(str)                 // → number (ms; variable-length units not allowed)
parser.startOf(date, period, options?)    // → Date
parser.endOf(date, period, options?)      // → Date
parser.add(date, amount, unit, options?)  // → Date
```

---

## Extending

Pass custom plugins to `new TimeParser([...Standard, myPlugin])`. Patterns are compiled at construction time, so you cannot extend an existing instance - create a new `TimeParser` instead.

```js
const myPlugin = {
    periods: {
        sprint: {
            names: ["sprint", "sprints"],
            step:  (d, n) => d.setDate(d.getDate() + n * 14),
            ms:    14 * 86_400_000,
        },
    },
    constants: {
        epoch: { names: ["epoch"], anchor: null, resolve: () => new Date(0) },
    },
};

const parser = new TimeParser([...Standard, myPlugin]);
parser.parse("+2sprint");   // 4 weeks from now
parser.parse("epoch");      // 1970-01-01T00:00:00.000Z
```

---

## Grafana / Elasticsearch compatibility

The parser accepts ES date-math syntax as a strict superset:
- `||` anchor separators are stripped
- Uppercase `M` (month) is rewritten to `mo` before parsing to avoid collision with `m` (minute)
