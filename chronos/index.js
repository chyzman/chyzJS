// Chronos — ESM entry point
// Combines core.js, expression.js, and format.js into a single ESM module.
// The original files remain unchanged for @require usage.

// ── Helpers (from core.js) ────────────────────────────────────────────────────

function _getNow(o) {
    return o?.now ? new Date(o.now) : new Date();
}

function _startOfDayInTz(date, tz) {
    const dateStr = new Intl.DateTimeFormat("en-CA", {timeZone: tz}).format(date);
    const [y, mo, d] = dateStr.split("-").map(Number);
    let t = Date.UTC(y, mo - 1, d);
    for (let i = 0; i < 2; i++) {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
        }).formatToParts(new Date(t));
        const get = type => +parts.find(p => p.type === type).value;
        t -= (get("hour") * 3600 + get("minute") * 60 + get("second")) * 1000;
    }
    return new Date(t);
}

function _startOfDay(d, o) {
    return o?.tz ? _startOfDayInTz(d, o.tz) : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function _stepBusinessDays(d, n, o) {
    const dir = n < 0 ? -1 : 1;
    let rem = Math.abs(Math.round(n));
    while (rem > 0) {
        d.setDate(d.getDate() + dir);
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6 && !o?.isHoliday?.(d)) rem--;
    }
}

function _stepBusinessHours(d, n, o) {
    const sh = o?.businessHoursStart ?? 9;
    const eh = o?.businessHoursEnd ?? 17;
    const dir = n < 0 ? -1 : 1;
    let rem = Math.abs(Math.round(n));
    while (rem > 0) {
        d.setHours(d.getHours() + dir);
        const dow = d.getDay(), h = d.getHours();
        if (dow !== 0 && dow !== 6 && !o?.isHoliday?.(d) && h >= sh && h < eh) rem--;
    }
}

function _startOfFiscalYear(d, o) {
    const s = _startOfDay(d, o);
    const fyStart = o?.fiscalYearStart ?? 0;
    const fy = new Date(s.getFullYear(), fyStart, 1);
    if (fy > s) fy.setFullYear(fy.getFullYear() - 1);
    return fy;
}

const _trunc = step => d => new Date(Math.floor(+d / step) * step);

function _expandNames(names) {
    const out = [];
    for (const n of names) {
        if (!n.includes("?")) { out.push(n); continue; }
        const parts = n.split("?");
        let acc = parts[0];
        out.push(acc);
        for (let i = 1; i < parts.length; i++) { acc += parts[i]; out.push(acc); }
    }
    return out;
}

// ── Chronos class (from core.js) ─────────────────────────────────────────────

class Chronos {
    constructor(plugins = [], options = {}) {
        this.periods = {};
        this.constants = {};
        this.timeNames = {};

        const pluginDefaults = {};
        for (const p of plugins) {
            Object.assign(this.periods, p.periods ?? {});
            Object.assign(this.constants, p.constants ?? {});
            Object.assign(this.timeNames, p.timeNames ?? {});
            Object.assign(pluginDefaults, p.defaults ?? {});
        }
        this._defaults = {...pluginDefaults, ...options};

        this._unitMap = new Map();
        this._csNames = [];
        for (const u of Object.values(this.periods)) {
            u._fixed = !u.step && u.length != null;
            if (!u.step && u.length != null) u.step = (d, n) => d.setTime(d.getTime() + n * u.length);
            if (!u.start && u.length != null) u.start = _trunc(u.length);
            const expanded = _expandNames(u.names);
            const ci = expanded.filter(n => n === n.toLowerCase());
            const cs = expanded.filter(n => n !== n.toLowerCase());
            for (const n of ci) this._unitMap.set(n, u);
            for (const n of cs) {
                this._unitMap.set(n, u);
                this._csNames.push({ name: n, canonical: ci[0] ?? n.toLowerCase() });
            }
        }

        this._constantMap = new Map();
        for (const c of Object.values(this.constants))
            for (const n of c.names) this._constantMap.set(n.toLowerCase(), c);
    }

    _opts(call = {}) {
        return {...this._defaults, ...call};
    }

    _findUnit(name) {
        return this._unitMap.get(name) ?? this._unitMap.get(name.toLowerCase()) ?? null;
    }

    _findConstant(name) {
        return this._constantMap.get(name.toLowerCase()) ?? null;
    }

    startOf(date, period, options = {}) {
        const opts = this._opts(options);
        const u = this._findUnit(period);
        if (!u) throw new Error(`Unknown period: ${period}`);
        return u.start(new Date(date), opts);
    }

    endOf(date, period, options = {}) {
        const opts = this._opts(options);
        const u = this._findUnit(period);
        if (!u) throw new Error(`Unknown period: ${period}`);
        const s = u.start(new Date(date), opts);
        if (u._fixed) return new Date(s.getTime() + u.length - 1);
        u.step(s, 1, opts);
        return new Date(s.getTime() - 1);
    }

    add(date, amount, unit, options = {}) {
        const opts = this._opts(options);
        const u = this._findUnit(unit);
        if (!u) throw new Error(`Unknown unit: ${unit}`);
        const d = new Date(date);
        u.step(d, amount, opts);
        return d;
    }
}

// ── Periods (from core.js) ────────────────────────────────────────────────────

const ms = { names: ["ms", "milli?second?s"], length: 1 };
const second = { names: ["s", "sec", "second?s"], length: ms.length * 1000 };
const minute = { names: ["m", "min", "minute?s"], length: second.length * 60 };
const hour = { names: ["h", "hr", "hour?s"], length: minute.length * 60 };
const day = {
    names: ["d", "day?s"],
    length: hour.length * 24,
    start: _startOfDay,
    step: (d, n) => d.setDate(d.getDate() + n),
};
const week = {
    names: ["w", "wk", "week?s"],
    length: day.length * 7,
    start(d, o) {
        const s = _startOfDay(d, o);
        s.setDate(s.getDate() - s.getDay());
        return s;
    },
    step: (d, n) => d.setDate(d.getDate() + n * 7),
};
const year = {
    names: ["y", "yr", "year?s"],
    length: day.length * (365 * 400 + 97) / 400,
    start(d, o) {
        const s = _startOfDay(d, o);
        s.setMonth(0, 1);
        return s;
    },
    step(d, n) {
        const w = Math.trunc(n), f = n - w;
        if (w) {
            const prev = d.getMonth();
            d.setFullYear(d.getFullYear() + w);
            if (d.getMonth() !== prev) d.setDate(0);
        }
        if (f) {
            const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
            d.setTime(d.getTime() + f * (isLeap(d.getFullYear()) ? 366 : 365) * 24 * 60 * 60 * 1000);
        }
    },
};
const month = {
    names: ["M", "mo", "month?s"],
    length: (365 * 400 + 97) / 400 * 24 * 60 * 60 * 1000 / 12,
    start(d, o) {
        const s = _startOfDay(d, o);
        s.setDate(1);
        return s;
    },
    step(d, n) {
        const w = Math.trunc(n), f = n - w;
        if (w) {
            const em = (((d.getMonth() + w) % 12) + 12) % 12;
            d.setMonth(d.getMonth() + w);
            if (d.getMonth() !== em) d.setDate(0);
        }
        if (f) {
            const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
            d.setTime(d.getTime() + f * days * 24 * 60 * 60 * 1000);
        }
    },
};
const quarter = {
    names: ["q", "quarter?s"],
    length: (365 * 400 + 97) / 400 * 24 * 60 * 60 * 1000 / 4,
    start(d, o) {
        const s = _startOfDay(d, o);
        s.setDate(1);
        s.setMonth(Math.floor(s.getMonth() / 3) * 3);
        return s;
    },
    step(d, n) {
        if (Number.isInteger(n)) {
            const em = (((d.getMonth() + n * 3) % 12) + 12) % 12;
            d.setMonth(d.getMonth() + n * 3);
            if (d.getMonth() !== em) d.setDate(0);
        } else {
            d.setTime(d.getTime() + n * (365 * 400 + 97) / 400 * 24 * 60 * 60 * 1000 / 4);
        }
    },
};
const bd = { names: ["bd", "bday?s", "business day?s"], step: _stepBusinessDays };
const bh = { names: ["bh", "bhour?s", "business hour?s"], step: _stepBusinessHours };
const fy = {
    names: ["fy", "fiscal year?s", "fiscal-year?s"],
    length: year.length,
    start: _startOfFiscalYear,
    step: (d, n) => d.setFullYear(d.getFullYear() + n),
};
const fq = {
    names: ["fq", "fiscal quarter?s", "fiscal-quarter?s"],
    length: year.length / 4,
    start(d, o) {
        const s = _startOfFiscalYear(d, o);
        const monthsIn = (_startOfDay(d, o).getMonth() - s.getMonth() + 12) % 12;
        s.setMonth(s.getMonth() + Math.floor(monthsIn / 3) * 3);
        return s;
    },
    step: (d, n) => d.setMonth(d.getMonth() + n * 3),
};
const semiMonth = {
    names: ["sm", "semi-month?s", "semimonth?s"],
    length: month.length / 2,
    start(d, o) {
        const s = _startOfDay(d, o);
        s.setDate(s.getDate() >= 16 ? 16 : 1);
        return s;
    },
    step(d, n) {
        const w = Math.trunc(n), f = n - w;
        let rem = Math.abs(w);
        const dir = w < 0 ? -1 : 1;
        while (rem-- > 0) {
            if (dir > 0) {
                if (d.getDate() < 16) d.setDate(16);
                else d.setMonth(d.getMonth() + 1, 1);
            } else {
                if (d.getDate() >= 16) d.setDate(1);
                else d.setMonth(d.getMonth() - 1, 16);
            }
        }
        if (f) d.setTime(d.getTime() + f * month.length / 2);
    },
};

// ── Constants & time names (from core.js) ─────────────────────────────────────

const now = {names: ["~", "now"], anchor: null, resolve: o => _getNow(o)};
const today = {names: ["today"], anchor: "day", resolve: o => _startOfDay(_getNow(o), o)};
const yesterday = {
    names: ["yesterday"], anchor: "day", resolve: o => {
        const d = _startOfDay(_getNow(o), o);
        d.setDate(d.getDate() - 1);
        return d;
    }
};
const tomorrow = {
    names: ["tomorrow"], anchor: "day", resolve: o => {
        const d = _startOfDay(_getNow(o), o);
        d.setDate(d.getDate() + 1);
        return d;
    }
};

// ── Plugin bundles (from core.js) ─────────────────────────────────────────────

const CorePeriods = {periods: {ms, second, minute, hour, day, week, month, semiMonth, quarter, year}};
const BusinessPeriods = {periods: {bd, bh}};
const FiscalPeriods = {periods: {fy, fq}};
const CoreConstants = {constants: {now, today, yesterday, tomorrow}};
const CoreTimeNames = {timeNames: {midnight: [0, 0, 0], noon: [12, 0, 0], eod: [23, 59, 59]}};

const WeekdayPeriods = {
    periods: Object.fromEntries(
        ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((short, i) => {
            const long = new Intl.DateTimeFormat("en-US", {weekday: "long"})
                .format(new Date(2024, 0, 7 + i)).toLowerCase();
            return [short, {
                names: [short, long],
                length: week.length,
                start(d, o) {
                    const s = _startOfDay(d, o);
                    s.setDate(s.getDate() - (s.getDay() - i + 7) % 7);
                    return s;
                },
                step: (d, n) => d.setDate(d.getDate() + n * 7),
            }];
        })
    )
};

const Standard = [CorePeriods, WeekdayPeriods, CoreConstants, CoreTimeNames];

// ── Expression plugin (from expression.js) ────────────────────────────────────

(function () {
    function _escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

    function _compile(t) {
        const ciKeys = k => k === k.toLowerCase();
        const unitPat     = [...t._unitMap.keys()].filter(ciKeys).sort((a, b) => b.length - a.length).join("|");
        const anchorPat   = [...t._unitMap.keys()].filter(ciKeys).sort((a, b) => b.length - a.length).join("|");
        const constantPat = [...t._constantMap.keys()].sort((a, b) => b.length - a.length).join("|");
        const timeNamePat = Object.keys(t.timeNames).sort((a, b) => b.length - a.length).join("|");

        t._csPreprocess = (t._csNames ?? [])
            .slice().sort((a, b) => b.name.length - a.name.length)
            .map(({ name, canonical }) => [
                new RegExp(`(?<![a-zA-Z])${_escRe(name)}(?![a-zA-Z])`, "g"),
                canonical,
            ]);

        t._re = {
            tzSuffix:     /\[([A-Za-z_]+(?:\/[A-Za-z_]+)*)\]$/,
            anchor:       new RegExp(`^\\^(-?\\d+)?(${anchorPat})`, "i"),
            iso:          /^(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:\.\d{3})?)?)/,
            constant:     new RegExp(`^(${constantPat})(?=[-+@$/\\s]|$)`, "i"),
            implicit:     /^([+-])/,
            time:         new RegExp(`@(?:(${timeNamePat})|(?:(\\d{1,2}):(\\d{2})(?::(\\d{2}))?))`, "i"),
            snap:         new RegExp(`/(${anchorPat})`, "i"),
            offset:       new RegExp(`([+-])(\\d+(?:\\.\\d+)?)\\s*(${unitPat})`, "gi"),
            duration:     new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${unitPat})`, "gi"),
            anchorFull:   new RegExp(`^\\^(-?\\d+)?(${anchorPat})\\s*$`, "i"),
            constantFull: new RegExp(`^(${constantPat})\\s*$`, "i"),
        };
    }

    function _ensure(t) {
        if (!t._re) _compile(t);
    }

    function _getNow(o) {
        return o?.now ? new Date(o.now) : new Date();
    }

    function _one(t, str, options) {
        str = str.trim().replace(/\|\|/g, "");

        const tzMatch = str.match(t._re.tzSuffix);
        if (tzMatch) {
            str     = str.slice(0, tzMatch.index).trim();
            options = { ...options, tz: tzMatch[1] };
        }

        for (const [pat, rep] of t._csPreprocess) str = str.replace(pat, rep);
        const opts = t._opts(options);

        let date, anchor, rest;

        const am = str.match(t._re.anchor);
        const im = str.match(t._re.iso);
        const cm = str.match(t._re.constant);
        const pm = str.match(t._re.implicit);

        if (am) {
            anchor = am[2];
            date   = t.startOf(_getNow(opts), anchor, opts);
            const n = am[1] !== undefined ? parseInt(am[1]) : 0;
            if (n !== 0) t._findUnit(anchor).step(date, n, opts);
            rest = str.slice(am[0].length);
        } else if (im) {
            date = new Date(im[1]);
            rest = str.slice(im[0].length);
        } else if (cm) {
            const c = t._findConstant(cm[1]);
            anchor  = c.anchor;
            date    = c.resolve(opts);
            rest    = str.slice(cm[0].length);
        } else if (pm) {
            date = _getNow(opts);
            rest = str;
        } else {
            throw new Error(`Invalid time expression: ${str}`);
        }

        rest = rest.trim();

        const tm = rest.match(t._re.time);
        if (tm) rest = (rest.slice(0, tm.index) + rest.slice(tm.index + tm[0].length)).trim();

        const sm = rest.match(t._re.snap);
        if (sm) { rest = rest.replace(sm[0], "").trim(); anchor = sm[1]; }

        const hasDollar = rest.endsWith("$");
        if (hasDollar) rest = rest.slice(0, -1).trim();

        for (const m of rest.matchAll(t._re.offset))
            date = t.add(date, parseFloat(m[2]) * (m[1] === "+" ? 1 : -1), m[3], opts);

        const unparsed = rest.replace(t._re.offset, "").trim();
        if (unparsed.length > 0) throw new Error(`Unexpected tokens in time expression: "${unparsed}"`);

        if (hasDollar)   date = t.endOf(date, anchor ?? "day", opts);
        else if (sm)     date = t.startOf(date, anchor, opts);

        if (tm) {
            if (tm[1]) {
                const [h, mn, s] = t.timeNames[tm[1].toLowerCase()];
                date.setHours(h, mn, s, 0);
            } else {
                date.setHours(+tm[2], +tm[3], tm[4] ? +tm[4] : 0, 0);
            }
        }

        return date;
    }

    Object.assign(Chronos.prototype, {
        parse(str, options = {}) {
            _ensure(this);
            if (/\.\.| - | to |>/.test(str)) throw new Error(`Use parseRange() for range expressions`);
            return _one(this, str, options);
        },

        parseRange(str, options = {}) {
            _ensure(this);
            const sep = str.match(/\.\.| - | to |>/);
            if (sep) {
                return [
                    _one(this, str.slice(0, sep.index), options),
                    _one(this, str.slice(sep.index + sep[0].length), options),
                ];
            }
            const trimmed = str.trim();
            const am = trimmed.match(this._re.anchorFull);
            const cm = trimmed.match(this._re.constantFull);
            if (am || cm) {
                const start  = _one(this, trimmed, options);
                const period = am ? am[2] : (this._findConstant(cm[1]).anchor ?? "day");
                return [start, this.endOf(start, period, options)];
            }
            throw new Error(`Cannot infer range from expression: ${str} — use "start > end" or similar`);
        },

        parseDuration(str) {
            _ensure(this);
            let total = 0, matched = false;
            for (const m of str.matchAll(this._re.duration)) {
                const u = this._findUnit(m[2]);
                const ms = u.length;
                if (ms == null) throw new Error(`"${m[2]}" has no fixed length and cannot be used in a duration`);
                total += parseFloat(m[1]) * ms;
                matched = true;
            }
            if (!matched) throw new Error(`No duration found in: ${str}`);
            return total;
        },
    });
})();

// ── Format plugin (from format.js) ───────────────────────────────────────────

(function () {
    const _UNIT = { y: "y", M: "mo", w: "w", d: "d", h: "h", m: "m", s: "s", S: "ms" };
    const _TOKEN = /\{([a-zA-Z]+)(?::([^:}]*):([^}]*))?\}/g;
    const _GROUP = /\[([^\]]*)\]/g;

    function _periodMs(period) { return period.length; }

    function _fmt(token, val) {
        if (token.length === 1) return String(val);
        return String(val).padStart(token.length, "0");
    }

    function _calCount(anchorMs, remainingMs, period, opts) {
        const target = anchorMs + remainingMs;
        const d = new Date(anchorMs);
        const approx = period.length;

        let count = Math.max(0, Math.floor(remainingMs / approx) - 1);
        if (count > 0) period.step(d, count, opts);

        const next = new Date(d);
        period.step(next, 1, opts);
        while (next.getTime() <= target) {
            d.setTime(next.getTime());
            period.step(next, 1, opts);
            count++;
        }

        return { count, remaining: target - d.getTime() };
    }

    Chronos.prototype.formatDuration = function (ms, template = "[{h}:]{mm}:{ss}", options = {}) {
        const opts    = this._opts(options);
        const anchor  = options.anchor != null ? +options.anchor : null;
        const totalMs = Math.max(0, Math.floor(+ms));

        const seen = new Set();
        for (const m of template.matchAll(_TOKEN)) {
            const ch = m[1][0];
            if (_UNIT[ch]) seen.add(ch);
        }

        const units = [];
        for (const ch of seen) {
            const period = this._findUnit(_UNIT[ch]);
            if (!period) continue;
            const pms = _periodMs(period);
            if (pms == null) continue;
            units.push({ ch, period, pms });
        }
        units.sort((a, b) => b.pms - a.pms);

        const vals = {};
        let remaining = totalMs;

        if (anchor != null) {
            let anchorMs = anchor;
            for (const { ch, period } of units) {
                if (period._fixed) {
                    vals[ch] = Math.floor(remaining / period.length);
                    remaining -= vals[ch] * period.length;
                } else {
                    const { count, remaining: rem } = _calCount(anchorMs, remaining, period, opts);
                    vals[ch] = count;
                    const d = new Date(anchorMs);
                    period.step(d, count, opts);
                    anchorMs = d.getTime();
                    remaining = rem;
                }
            }
        } else {
            for (const { ch, pms } of units) {
                vals[ch] = Math.floor(remaining / pms);
                remaining -= vals[ch] * pms;
            }
        }

        function inject(_, token, sing, plur) {
            const val = vals[token[0]] ?? 0;
            if (sing !== undefined) return val === 1 ? sing : plur;
            return _fmt(token, val);
        }

        let out = template.replace(_GROUP, (_, inner) => {
            for (const m of inner.matchAll(_TOKEN))
                if ((vals[m[1][0]] ?? 0) > 0) return inner;
            return "";
        });

        out = out.replace(_TOKEN, inject);

        return out
            .replace(/(<[^>]*>)(\s*<[^>]*>)+/g, "$1")
            .replace(/^\s*<[^>]*>\s*/, "")
            .replace(/\s*<[^>]*>\s*$/, "")
            .replace(/<([^>]*)>/g, "$1")
            .trim();
    };
})();

// ── Default instance & exports ────────────────────────────────────────────────

const Time = new Chronos([...Standard, BusinessPeriods, FiscalPeriods]);

export {
    Chronos,
    Time,
    CorePeriods,
    BusinessPeriods,
    FiscalPeriods,
    CoreConstants,
    CoreTimeNames,
    WeekdayPeriods,
    Standard,
};
