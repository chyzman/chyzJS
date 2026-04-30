// ─────────────────────────────────────────────────────────────────────────────
// Chronos — core period registry
//
// Period shape:
//   names:   string[]   — lookup aliases (case-insensitive in expression plugin)
//   length:  number     — exact ms per unit (fixed) or average ms (variable)
//   start:   function   — start(date, opts) → Date; defaults to _trunc(length)
//   step:    function   — calendar-aware step(date, n, opts); defaults to ±length ms
//
// Normalised at construction time (do not rely on these in period definitions):
//   _fixed:  boolean    — true when no explicit step was provided
//
// Plugins: plain objects with any of { periods, constants, timeNames, defaults }.
// Requiring expression.js / format.js adds methods to Chronos.prototype automatically.
// ─────────────────────────────────────────────────────────────────────────────

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Chronos ───────────────────────────────────────────────────────────────────

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
        for (const u of Object.values(this.periods)) {
            u._fixed = !u.step && u.length != null;
            if (!u.step && u.length != null) u.step = (d, n) => d.setTime(d.getTime() + n * u.length);
            if (!u.start && u.length != null) u.start = _trunc(u.length);
            for (const n of u.names) this._unitMap.set(n.toLowerCase(), u);
        }

        this._constantMap = new Map();
        for (const c of Object.values(this.constants))
            for (const n of c.names) this._constantMap.set(n.toLowerCase(), c);
    }

    _opts(call = {}) {
        return {...this._defaults, ...call};
    }

    _findUnit(name) {
        return this._unitMap.get(name.toLowerCase()) ?? null;
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

// ── Periods ───────────────────────────────────────────────────────────────────

const ms = {
    names: ["ms", "millisecond", "milliseconds"],
    length: 1,
};

const second = {
    names: ["s", "sec", "second", "seconds"],
    length: ms.length * 1000,
};

const minute = {
    names: ["m", "min", "minute", "minutes"],
    length: second.length * 60,
};

const hour = {
    names: ["h", "hr", "hour", "hours"],
    length: minute.length * 60,
};

const day = {
    names: ["d", "day", "days"],
    length: hour.length * 24,
    start: _startOfDay,
    step: (d, n) => d.setDate(d.getDate() + n),
};

const year = {
    names: ["y", "yr", "year", "years"],
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
    names: ["mo", "month", "months"],
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
    names: ["q", "quarter", "quarters"],
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



const bd = {
    names: ["bd", "bday", "bdays", "business day", "business days"],
    step: _stepBusinessDays,
};

const bh = {
    names: ["bh", "bhour", "bhours", "business hour", "business hours"],
    step: _stepBusinessHours,
};

const fy = {
    names: ["fy", "fiscal year", "fiscal-year"],
    length: (365 * 400 + 97) / 400 * 24 * 60 * 60 * 1000,
    start: _startOfFiscalYear,
    step: (d, n) => d.setFullYear(d.getFullYear() + n),
};

const fq = {
    names: ["fq", "fiscal quarter", "fiscal-quarter"],
    length: (365 * 400 + 97) / 400 * 24 * 60 * 60 * 1000 / 4,
    start(d, o) {
        const s = _startOfFiscalYear(d, o);
        const monthsIn = (_startOfDay(d, o).getMonth() - s.getMonth() + 12) % 12;
        s.setMonth(s.getMonth() + Math.floor(monthsIn / 3) * 3);
        return s;
    },
    step: (d, n) => d.setMonth(d.getMonth() + n * 3),
};

// ── Constants & time names ────────────────────────────────────────────────────

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

// ── Plugin bundles ────────────────────────────────────────────────────────────

const CorePeriods = {periods: {ms, second, minute, hour, day, week, month, quarter, year}};
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
                length: 7 * 24 * 60 * 60 * 1000,
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

const Time = new Chronos([...Standard, BusinessPeriods, FiscalPeriods]);
