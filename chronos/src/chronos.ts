import type { Constant, Options, Period, Plugin } from './types.js';

export function _getNow(o?: Options): Date {
    return o?.now ? new Date(o.now as string | number) : new Date();
}

export function _startOfDayInTz(date: Date, tz: string): Date {
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
    const [y, mo, d] = dateStr.split('-').map(Number);
    let t = Date.UTC(y, mo - 1, d);
    for (let i = 0; i < 2; i++) {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        }).formatToParts(new Date(t));
        const get = (type: string) => +(parts.find(p => p.type === type)!.value);
        t -= (get('hour') * 3600 + get('minute') * 60 + get('second')) * 1000;
    }
    return new Date(t);
}

export function _startOfDay(d: Date, o?: Options): Date {
    return o?.tz ? _startOfDayInTz(d, o.tz) : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function _stepBusinessDays(d: Date, n: number, o?: Options): void {
    const dir = n < 0 ? -1 : 1;
    let rem = Math.abs(Math.round(n));
    while (rem > 0) {
        d.setDate(d.getDate() + dir);
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6 && !o?.isHoliday?.(d)) rem--;
    }
}

export function _stepBusinessHours(d: Date, n: number, o?: Options): void {
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

export function _startOfFiscalYear(d: Date, o?: Options): Date {
    const s = _startOfDay(d, o);
    const fyStart = o?.fiscalYearStart ?? 0;
    const fy = new Date(s.getFullYear(), fyStart, 1);
    if (fy > s) fy.setFullYear(fy.getFullYear() - 1);
    return fy;
}

export const _trunc = (step: number) => (d: Date): Date => new Date(Math.floor(+d / step) * step);

export function _expandNames(names: string[]): string[] {
    const out: string[] = [];
    for (const n of names) {
        if (!n.includes('?')) { out.push(n); continue; }
        const parts = n.split('?');
        let acc = parts[0];
        out.push(acc);
        for (let i = 1; i < parts.length; i++) { acc += parts[i]; out.push(acc); }
    }
    return out;
}

export class Chronos {
    periods: Record<string, Period>;
    constants: Record<string, Constant>;
    timeNames: Record<string, [number, number, number]>;
    _defaults: Options;
    _unitMap: Map<string, Period>;
    _csNames: { name: string; canonical: string }[];
    _constantMap: Map<string, Constant>;
    // set at runtime by expression plugin
    _re?: Record<string, RegExp>;
    _csPreprocess?: [RegExp, string][];

    constructor(plugins: Plugin[] = [], options: Options = {}) {
        this.periods = {};
        this.constants = {};
        this.timeNames = {};

        const pluginDefaults: Partial<Options> = {};
        for (const p of plugins) {
            Object.assign(this.periods, p.periods ?? {});
            Object.assign(this.constants, p.constants ?? {});
            Object.assign(this.timeNames, p.timeNames ?? {});
            Object.assign(pluginDefaults, p.defaults ?? {});
        }
        this._defaults = { ...pluginDefaults, ...options };

        this._unitMap = new Map();
        this._csNames = [];
        for (const u of Object.values(this.periods)) {
            u._fixed = !u.step && u.length != null;
            if (!u.step && u.length != null) {
                const len = u.length;
                u.step = (d, n) => d.setTime(d.getTime() + n * len);
            }
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

    _opts(call: Options = {}): Options {
        return { ...this._defaults, ...call };
    }

    _findUnit(name: string): Period | null {
        return this._unitMap.get(name) ?? this._unitMap.get(name.toLowerCase()) ?? null;
    }

    _findConstant(name: string): Constant | null {
        return this._constantMap.get(name.toLowerCase()) ?? null;
    }

    startOf(date: Date | number | string, period: string, options: Options = {}): Date {
        const opts = this._opts(options);
        const u = this._findUnit(period);
        if (!u) throw new Error(`Unknown period: ${period}`);
        return u.start!(new Date(date as string | number), opts);
    }

    endOf(date: Date | number | string, period: string, options: Options = {}): Date {
        const opts = this._opts(options);
        const u = this._findUnit(period);
        if (!u) throw new Error(`Unknown period: ${period}`);
        const s = u.start!(new Date(date as string | number), opts);
        if (u._fixed) return new Date(s.getTime() + u.length! - 1);
        u.step!(s, 1, opts);
        return new Date(s.getTime() - 1);
    }

    add(date: Date | number | string, amount: number, unit: string, options: Options = {}): Date {
        const opts = this._opts(options);
        const u = this._findUnit(unit);
        if (!u) throw new Error(`Unknown unit: ${unit}`);
        const d = new Date(date as string | number);
        u.step!(d, amount, opts);
        return d;
    }
}
