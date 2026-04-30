// ─────────────────────────────────────────────────────────────────────────────
// Chronos — formatDuration plugin
// @require chronos/core.js
//
// Adds to Chronos.prototype: formatDuration
//
// Template syntax:
//   {token}              — unit value (unpadded for single char, zero-padded for double/triple)
//   {token:sing:plur}    — plural form: sing if value === 1, else plur
//   [...]                — optional group: omitted entirely when every token inside is zero
//   <sep>                — conditional separator: removed if adjacent to nothing or another <sep>
//
// Token chars (case-sensitive):
//   y  years    M  months   w  weeks    d  days
//   h  hours    m  minutes  s  seconds  S  milliseconds
//
// Examples:
//   "[{y}y ][{M}mo ][{d}d ]{h}:{mm}:{ss}"
//   "[{h}:]{mm}:{ss}.{SSS}"
//   "[{d} day{d:s:} <and >]{h} hr{h:s:}"
// ─────────────────────────────────────────────────────────────────────────────

(function () {
    // Maps format token char → period lookup name
    const _UNIT = { y: "y", M: "mo", w: "w", d: "d", h: "h", m: "m", s: "s", S: "ms" };

    const _TOKEN = /\{([a-zA-Z]+)(?::([^:}]*):([^}]*))?\}/g;
    const _GROUP = /\[([^\]]*)\]/g;

    function _periodMs(period) {
        return period.length;
    }

    function _fmt(token, val) {
        if (token.length === 1) return String(val);
        return String(val).padStart(token.length, "0");
    }

    // Calendar-accurate counting: how many full `period` steps fit in `remainingMs`
    // starting from `anchorMs`. Returns { count, remaining }.
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

        // ── Discover units referenced in template ─────────────────────────────
        const seen = new Set();
        for (const m of template.matchAll(_TOKEN)) {
            const ch = m[1][0];
            if (_UNIT[ch]) seen.add(ch);
        }

        // ── Build ordered unit list (largest ms first) ────────────────────────
        const units = [];
        for (const ch of seen) {
            const period = this._findUnit(_UNIT[ch]);
            if (!period) continue;
            const pms = _periodMs(period);
            if (pms == null) continue;
            units.push({ ch, period, pms });
        }
        units.sort((a, b) => b.pms - a.pms);

        // ── Decompose ─────────────────────────────────────────────────────────
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

        // ── Resolve optional groups ───────────────────────────────────────────
        let out = template.replace(_GROUP, (_, inner) => {
            for (const m of inner.matchAll(_TOKEN))
                if ((vals[m[1][0]] ?? 0) > 0) return inner;
            return "";
        });

        // ── Inject tokens ─────────────────────────────────────────────────────
        out = out.replace(_TOKEN, inject);

        // ── Resolve conditional separators ────────────────────────────────────
        return out
            .replace(/(<[^>]*>)(\s*<[^>]*>)+/g, "$1")
            .replace(/^\s*<[^>]*>\s*/, "")
            .replace(/\s*<[^>]*>\s*$/, "")
            .replace(/<([^>]*)>/g, "$1")
            .trim();
    };
})();
