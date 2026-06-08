# Building Custom Indicators on Orca

Custom Indicators is your workspace for writing your own indicator logic in
Python, testing it against real cached market data, saving it, and — once it
passes — using it in your strategies right alongside Orca's built-in
indicators. This guide is the same one Orca's Indicator Assistant reads before
it answers your questions — if you're stuck, the assistant can walk through any
of this with you (in **Ask** mode it can explain and suggest code; in **Agent**
mode it can write the code — and update your declared parameters to match — for
you, applied straight into the editor).

## Native vs. Custom indicators

- **Native indicators** (PRICE, VOLUME, SMA, EMA, RSI, MACD, ...) ship with
  Orca. They're shown for reference — you can see how they're configured, but
  you can't edit or delete them.
- **Custom indicators** are yours. You write the logic, test it, save it, can
  edit or delete it whenever you like — and once saved, you can reference it by
  name in a strategy's conditions exactly like a native one (e.g.
  `MyMomentum(period=20) > 5`).

## At a glance: input in, one number out

Every indicator you write is evaluated **one candle at a time**. Each time it
runs, it receives exactly three inputs and must hand back exactly one output:

| Name | Direction | What it is | Type & shape | How you use it |
|---|---|---|---|---|
| `data` | in | Every loaded candle, oldest → newest | `pandas.DataFrame`, `DatetimeIndex`, columns `Open`/`High`/`Low`/`Close`/`Volume` (all numeric) | `data["Close"].iloc[context["i"]]`, slice with `.iloc[start : stop]` |
| `context` | in | "Where am I right now?" | `dict` with one key, `context["i"]` (an `int`) | Index everything relative to it — never a hard-coded row number |
| `params` | in | Your declared parameters, defaults already filled in | `dict`, arrives via `**params` | `params.get("period", 14)` — keep the fallback in sync with your declared default |
| `result` | **out** | Your indicator's value for *this* candle | a plain `int`/`float`, or `float("nan")` | assign it; the locked `return result` hands it back for you |

If you remember nothing else from this page: **only ever read rows up to and
including `context["i"]`, and finish by assigning exactly one number to
`result`.** Everything below is detail on those two rules.

## The rigid contract — what the editor actually saves

Every indicator — native or custom — is built the same way underneath: a
function that receives the market data and the current candle, and returns one
number. To guarantee that shape, the editor only ever lets you write the
**body** of this fixed function. The first line and the `return` line are
locked and shown to you, greyed out, above and below the code box — you can't
edit, remove, or see past them in what you submit:

```python
def calculate(data, context, **params):
    # <-- you write only this part -->
    return result
```

You can't change the function's name, its inputs, or what it returns. That's
intentional: it's what lets the compiler/tester — and later, the backtester —
run *every* custom indicator the exact same way, and it mirrors how Orca's own
native indicators (`get_price`, `get_volume`, `compute_rsi`, ...) are written
internally. Whatever you type is wrapped in this template before it's ever
parsed, compiled, or run — there's no way around it, and no need to fight it.

### `data` — the market data, in full

`data` is a `pandas.DataFrame` holding the **entire loaded range** of OHLCV
candles for the relevant ticker and timeframe — not a rolling window, not just
"recent" candles, all of it — indexed in chronological order (oldest row first)
by a `DatetimeIndex`, with exactly these columns:

| Column   | Meaning                  | dtype     |
|----------|--------------------------|-----------|
| `Open`   | Candle open price        | `float64` |
| `High`   | Candle high price        | `float64` |
| `Low`    | Candle low price         | `float64` |
| `Close`  | Candle close price       | `float64` |
| `Volume` | Traded volume            | `float64` |

Pull a column out as a `pandas.Series` with `data["Close"]` /
`data["Volume"]` / etc., then index into it **by position** with `.iloc[...]`
— not by date, and not with plain `[...]`, which indexes by label on a
`DatetimeIndex` and will not do what you expect:

```python
current_close   = data["Close"].iloc[context["i"]]          # one value (float)
last_5_closes   = data["Close"].iloc[context["i"] - 4 : context["i"] + 1]  # a Series of 5
all_highs_so_far = data["High"].iloc[: context["i"] + 1]    # everything up to "now"
```

A slice like `.iloc[a:b]` is itself a `Series` — that's what lets you call
`.mean()`, `.max()`, `.min()`, `.std()`, `.sum()`, `.iloc[-1]`, and so on, on
it. You'll typically pull a small window like this, reduce it to a single
number with one of those, and that becomes (or feeds into) `result`.

### `context` — where "now" is

`context` is a `dict` with exactly one key you'll use:

- `context["i"]` — the integer **position** (0-based) of the candle currently
  being evaluated, within `data`. It ranges from `0` (the very first loaded
  candle) up to `len(data) - 1` (the most recent one).

Think of `context["i"]` as "now." Your indicator gets called once per candle as
Orca scans forward through history — first with `context["i"] = 0`, then `1`,
then `2`, and so on — exactly like it would if it were running live, one new
candle at a time. To look at the present or the past, index relative to it:

```python
now            = data["Close"].iloc[context["i"]]
one_ago        = data["Close"].iloc[context["i"] - 1]
last_20_closes = data["Close"].iloc[context["i"] - 19 : context["i"] + 1]
```

**Never read past `context["i"]`** — i.e. never index with anything that could
resolve to a row *after* the current one (`context["i"] + 1` or later). That's
**lookahead bias**: using information that wouldn't have existed yet at the
time your indicator is supposedly making its call. It's the single most common
way a homemade indicator looks brilliant in a preview chart and then falls
apart the moment it's actually informing a decision — because in the real
world, "future" candles simply haven't happened yet.

Also guard the *start* of the series: early on, there may not be `period`
candles of history available yet (`context["i"] - period + 1` can go negative).
Clamp it with `max(0, ...)`, and treat "not enough history" as "not defined
yet" rather than crashing or quietly computing a misleading value from a
too-short window:

```python
period = int(params.get("period", 14))
start = max(0, context["i"] - period + 1)
window = data["Close"].iloc[start : context["i"] + 1]

if len(window) < period:
    result = float("nan")
else:
    ...
```

### `params` — your declared parameters, with their defaults already applied

Every non-trivial indicator needs configuration — a lookback `period`, a
`multiplier`, a smoothing factor, and so on (the same idea as the native `SMA`
declaring `period=14`, or `MACD` declaring `fast`/`slow`/`signal`). That's what
the **Parameters** panel on the right of the editor is for: each row is one
`{name, default}` pair. Declare a name and a sensible default for each value
your formula needs, and Orca passes the whole set into your function as
`**params` — a plain `dict` keyed by those names, with your saved default
values already filled in (or, later, whatever values a strategy condition
supplies — see "Using it in a strategy" below).

Read each one with `.get(name, default)`, repeating the same default as a
fallback — that keeps your code self-explanatory and resilient even if the
declared list and the body briefly disagree:

```python
period      = int(params.get("period", 14))         # declared default: 14 (an int)
multiplier  = float(params.get("multiplier", 2.0))  # declared default: 2.0 (a float)
field       = str(params.get("field", "close"))     # declared default: "close" (a string)
```

A few things worth knowing about the shapes here:
- Defaults can be a number (`int`/`float`) or short text (`str`) — pick
  whichever matches how you'll use the value, and coerce with `int(...)` /
  `float(...)` / `str(...)` defensively, since the value that ultimately
  arrives could come from a strategy condition rather than your saved default.
- Parameter **names** must be valid, unique Python identifiers, and can't be
  one of the names the contract itself already uses — `data`, `context`,
  `params`, `self`, `result`, `calculate` — or the generic argument names every
  indicator call accepts in a strategy condition — `ticker`, `timeframe`,
  `offset`. The editor and the save-time check both enforce this.
- Add, rename, or remove rows any time with the **+ Add** button and the
  trash icon next to each row — just keep the body's `params.get(...)` calls in
  sync with whatever you declare (the **Agent** can do both together for you;
  see "Getting help from the assistant").

### `result` — the one number you must produce

Before the locked `return result` line runs, assign a single value to a
variable named exactly `result`. It must end up being one of:

- a plain `int` or `float` — your indicator's reading for *this* candle, or
- `float("nan")` — meaning "not defined yet" (not enough history, a division
  that would be by zero, etc.). `NaN` is a first-class, expected output, not an
  error — use it whenever a real number wouldn't be meaningful.

It must **not** be a `pandas.Series`, a `numpy` array, a `bool`, a `str`, or
`None` — exactly one scalar number (or `NaN`) per call, every time:

```python
period = int(params.get("period", 14))
start = max(0, context["i"] - period + 1)
window = data["Close"].iloc[start : context["i"] + 1]

if len(window) < period:
    result = float("nan")
else:
    result = float(window.mean() - data["Close"].iloc[context["i"]])
```

Returning a single scalar — rather than, say, a whole computed `Series` — is
what makes every custom indicator interchangeable with every native one: the
compiler/tester, the preview chart, and the backtester can all call it,
candle by candle, and treat whatever comes back identically, with no ambiguity
about which candle a value belongs to.

## What you can and can't use

Your code runs inside a sandbox before it's ever compiled or executed. That's
not optional — it's what makes it safe for Orca to compile and run indicator
code that any user can write, on shared infrastructure, without one person's
indicator being able to see or affect anything outside its own calculation.

**Available:**
- `pd` — pandas
- `np` — numpy
- `math` — Python's `math` module
- Everyday builtins: `abs`, `min`, `max`, `sum`, `len`, `round`, `range`,
  `enumerate`, `zip`, `sorted`, `float`, `int`, `bool`, `str`, `list`, `dict`,
  `tuple`, `set`, `isinstance`, and friends
- Normal Python control flow: `if`/`elif`/`else`, `for`, `while`, `try`/`except`,
  `with`, helper `def`s, `lambda`s, comprehensions — anything you'd write in an
  ordinary function body

**Not available, and why:**
- `import` (or `from ... import`) — your code can't reach outside the sandbox;
  everything you're likely to need (`pd`, `np`, `math`) is already provided
- File, network, or process access, and reflection (`open`, `exec`, `eval`,
  `compile`, `input`, `getattr`/`setattr`/`hasattr`, `globals`/`locals`, ...) —
  indicator code only ever computes a number from the data it's handed
- "Dunder" name and attribute access (`__class__`, `__subclasses__`,
  `__import__`, `__builtins__`, ...) — the classic way sandboxed Python gets
  escaped, so it's blocked at the syntax-tree level, outright

If your code trips one of these, the compiler/tester tells you exactly which
line and why before it ever runs anything — fix it and re-run the test.

## How your indicator actually gets run — the processing pipeline

Click **Run Test** and Orca walks your code through four steps, in order,
stopping and reporting back at the first one that doesn't pass:

1. **Validate** — your code is parsed into a syntax tree and walked, checked
   against every rule in "What you can and can't use" above (no imports, no
   sandbox-escape patterns, valid Python syntax) — *before* anything is ever
   compiled or executed.
2. **Compile** — what passes validation is wrapped in the locked
   `def calculate(data, context, **params): ...; return result` template (the
   exact shape shown earlier — never anything else) and loaded into a
   restricted namespace that exposes only `pd`, `np`, `math`, and the safe
   builtin allowlist. Nothing else in the Python environment is reachable from
   inside it.
3. **Run, one candle at a time** — Orca calls your compiled function
   `calculate(data, context, **params)` once per candle in a recent test
   window of real cached OHLCV data, advancing `context["i"]` forward one step
   per call (`0`, then `1`, then `2`, ...) — using each parameter's *declared
   default* — inside a bounded wall-clock timeout, so a runaway loop can't hang
   the page (it's simply abandoned and reported as a timeout).
4. **Check the output** — every single call must produce a plain number (or
   `NaN`); the moment one doesn't, you get told exactly which candle and what
   came back instead. If every call checks out, you get a passing result and a
   chart of the resulting series so you can see your indicator's actual shape
   over time, candle by candle.

You must get a passing test — for the *exact* code and parameters you're about
to save — before **Save**/**Update** unlocks (note how the button re-disables
the moment you touch the code or a parameter afterward: the pass you're relying
on has to match what you're persisting). And the server independently re-runs
the same four steps regardless of what the editor reports, so there's no path
to saving something that wouldn't actually pass.

### Using it in a strategy — the same call, a different stage

Once an indicator passes the test and is saved, it stops being just a
standalone preview: you can reference it **by name**, directly inside a
strategy's `CONDITIONS`, exactly the way you'd write a native one — e.g.

```
MyMomentum(period=20) > 0 AND RSI(period=14) < 70
```

When a backtest runs, Orca calls your saved indicator the *same* way the
tester did — `calculate(data, context, **params)`, one candle at a time, never
reading past `context["i"]` — except now `data` is the strategy's actual
execution-timeframe market data, `context["i"]` walks forward through the
whole backtest, and `params` is built from whatever you wrote inside the
parentheses in the condition (`period=20` above), falling back to your declared
defaults for anything you didn't specify. This is exactly why the contract is
locked the way it is: the same function, called the same way, behaves
identically whether it's drawing a preview chart or deciding whether a strategy
opens a position.

A couple of things to keep in mind once you're at this stage:
- Your indicator's **name** is also its reference token in conditions, so it
  must be a valid identifier (letters, digits, underscores, starting with a
  letter — e.g. `MyMomentum`) and can't collide with a built-in indicator's
  name. The editor enforces this when you save.
- A backtest only fails loudly on a genuinely unknown indicator name — a typo,
  or one you've since renamed or deleted. A *known* indicator that can't
  produce a value for a given candle (too early in history, a guarded
  division, ...) should simply return `float("nan")` for it, exactly like the
  tester expects — the strategy engine treats that candle's condition as not
  met and moves on, which is the whole point of returning `NaN` rather than
  raising.

## Two worked examples

**Distance from a moving average** — how far (in price terms) the close is
from its own recent mean; positive means "above," negative means "below":

```python
period = int(params.get("period", 20))
start = max(0, context["i"] - period + 1)
window = data["Close"].iloc[start : context["i"] + 1]

if len(window) < period:
    result = float("nan")
else:
    result = float(data["Close"].iloc[context["i"]] - window.mean())
```

**Range compression** — how narrow the recent high/low range is relative to
price, as a percentage (a simple volatility-contraction read):

```python
period = int(params.get("period", 14))
start = max(0, context["i"] - period + 1)

highs = data["High"].iloc[start : context["i"] + 1]
lows = data["Low"].iloc[start : context["i"] + 1]
close = data["Close"].iloc[context["i"]]

if len(highs) < period or close == 0:
    result = float("nan")
else:
    result = float((highs.max() - lows.min()) / close * 100.0)
```

## Getting help from the assistant

Open the **Indicator Assistant** from the editor any time — it has read access
to this guide and your current draft (name, description, declared parameters,
code, and your most recent test result). It runs in two modes, switchable at
the top of the panel:

- **Ask** — talks things through without touching anything. Good for
  understanding your draft, debugging a failing test, checking for lookahead
  bias, or thinking out loud about what a parameter should do. It can suggest
  parameter changes in conversation, but can't apply them — that's what Agent
  mode (or the Parameters panel itself) is for.
- **Agent** — writes (or rewrites) the function body for you on request, and
  applies it straight into the editor in the correct shape. When the logic it
  writes needs a parameter that isn't declared yet — or stops needing one that
  is — it updates the declared parameter list to match, in the same step, so
  the body and the panel never drift out of sync. Always run the tester
  afterward to confirm the result.

If a conversation goes sideways — the assistant misunderstands what you're
after, gets stuck repeating itself, or you just want to start over with a
clean slate — click **New chat** at the top of the panel. It clears the
conversation (your draft itself is untouched) and starts fresh in the current
mode.

## Where to go from here

- Save a few variations with different parameter defaults and compare their
  preview charts side by side.
- Reference a saved indicator by name in a strategy's conditions, alongside
  native ones (`MyMomentum(period=20) > 5 AND RSI(period=14) < 30`), and run a
  backtest to see it in action.
- Remember: lookahead bias is the thing to keep checking for as your logic
  grows more involved — when in doubt, ask the assistant to do a
  "lookahead check" on your latest draft.
