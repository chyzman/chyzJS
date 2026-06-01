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

import { Chronos } from './chronos.js';
import type { Options, Period } from './types.js';

declare module './chronos.js' {
    interface Chronos {
        formatDuration(ms: number, template?: string, options?: Options): string;
    }
}

const _UNIT: Record<string, string> = { y: 'y', M: 'mo', w: 'w', d: 'd', h: 'h', m: 'm', s: 's', S: 'ms' };
const _TOKEN = /\{([a-zA-Z]+)(?::([^:}]*):([^}]*))?\}/g;
const _GROUP = /\[([^\]]*)\]/g;

function _fmt(token: string, val: number): string {
    if (token.length === 1) return String(val);
    return String(val).padStart(token.length, '0');
}

function _calCount(anchorMs: number, remainingMs: number, period: Period, opts: Options): { count: number; remaining: number } {
    const target = anchorMs + remainingMs;
    const d = new Date(anchorMs);
    const approx = period.length!;

    let count = Math.max(0, Math.floor(remainingMs / approx) - 1);
    if (count > 0) period.step!(d, count, opts);

    const next = new Date(d);
    period.step!(next, 1, opts);
    while (next.getTime() <= target) {
        d.setTime(next.getTime());
        period.step!(next, 1, opts);
        count++;
    }

    return { count, remaining: target - d.getTime() };
}

Chronos.prototype.formatDuration = function (
    this: Chronos,
    ms: number,
    template = '[{h}:]{mm}:{ss}',
    options: Options = {},
): string {
    const opts    = this._opts(options);
    const anchor  = options.anchor != null ? +options.anchor : null;
    const totalMs = Math.max(0, Math.floor(+ms));

    const seen = new Set<string>();
    for (const m of template.matchAll(_TOKEN)) {
        const ch = m[1][0];
        if (_UNIT[ch]) seen.add(ch);
    }

    const units: { ch: string; period: Period; pms: number }[] = [];
    for (const ch of seen) {
        const period = this._findUnit(_UNIT[ch]);
        if (!period) continue;
        const pms = period.length;
        if (pms == null) continue;
        units.push({ ch, period, pms });
    }
    units.sort((a, b) => b.pms - a.pms);

    const vals: Record<string, number> = {};
    let remaining = totalMs;

    if (anchor != null) {
        let anchorMs = anchor;
        for (const { ch, period } of units) {
            if (period._fixed) {
                vals[ch] = Math.floor(remaining / period.length!);
                remaining -= vals[ch] * period.length!;
            } else {
                const { count, remaining: rem } = _calCount(anchorMs, remaining, period, opts);
                vals[ch] = count;
                const d = new Date(anchorMs);
                period.step!(d, count, opts);
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

    function inject(_: string, token: string, sing: string | undefined, plur: string | undefined): string {
        const val = vals[token[0]] ?? 0;
        if (sing !== undefined) return val === 1 ? sing : plur!;
        return _fmt(token, val);
    }

    let out = template.replace(_GROUP, (_, inner: string) => {
        for (const m of inner.matchAll(_TOKEN))
            if ((vals[m[1][0]] ?? 0) > 0) return inner;
        return '';
    });

    out = out.replace(_TOKEN, inject);

    return out
        .replace(/(<[^>]*>)(\s*<[^>]*>)+/g, '$1')
        .replace(/^\s*<[^>]*>\s*/, '')
        .replace(/\s*<[^>]*>\s*$/, '')
        .replace(/<([^>]*)>/g, '$1')
        .trim();
};
