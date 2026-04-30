// ─────────────────────────────────────────────────────────────────────────────
// Chronos — expression parsing plugin
// @require chronos/core.js
//
// Adds to Chronos.prototype: parse, parseRange, parseDuration
//
// Expression syntax:  <base>[@time][offsets][/snap][$][[TZ]]
//   base:    ^[N]<anchor>  |  <constant>  |  <ISO date>  |  [+-]<offsets> (now)
//   N:       integer — steps the anchor before returning (1 = next, -1 = previous)
//   @:       set time-of-day: HH:MM[:SS] or a named time (midnight, noon, eod)
//   offsets: (+|-)<number><unit>  repeating, e.g. +1d-2h
//   /snap:   snap result to start of anchor
//   $:       snap to end instead of start
//   [TZ]:    IANA timezone override
// ─────────────────────────────────────────────────────────────────────────────

(function () {
    function _compile(t) {
        const unitPat     = [...t._unitMap.keys()].sort((a, b) => b.length - a.length).join("|");
        const anchorPat   = [...t._unitMap.keys()].sort((a, b) => b.length - a.length).join("|");
        const constantPat = [...t._constantMap.keys()].sort((a, b) => b.length - a.length).join("|");
        const timeNamePat = Object.keys(t.timeNames).sort((a, b) => b.length - a.length).join("|");

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
        str = str.trim()
            .replace(/\|\|/g, "")
            .replace(/([+-]\d+(?:\.\d+)?[ \t]*)M(?![a-zA-Z])/g, "$1mo")
            .replace(/\/M(?![a-zA-Z])/g, "/mo");

        const tzMatch = str.match(t._re.tzSuffix);
        if (tzMatch) {
            str     = str.slice(0, tzMatch.index).trim();
            options = { ...options, tz: tzMatch[1] };
        }
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
