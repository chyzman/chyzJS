import type { Constant, Period, Plugin } from './types.js';
import {
    _getNow,
    _startOfDay,
    _startOfFiscalYear,
    _stepBusinessDays,
    _stepBusinessHours,
    _trunc,
} from './chronos.js';

const ms: Period = { names: ['ms', 'milli?second?s'], length: 1 };
const second: Period = { names: ['s', 'sec', 'second?s'], length: ms.length! * 1000 };
const minute: Period = { names: ['m', 'min', 'minute?s'], length: second.length! * 60 };
const hour: Period = { names: ['h', 'hr', 'hour?s'], length: minute.length! * 60 };

const day: Period = {
    names: ['d', 'day?s'],
    length: hour.length! * 24,
    start: _startOfDay,
    step: (d, n) => d.setDate(d.getDate() + n),
};

const week: Period = {
    names: ['w', 'wk', 'week?s'],
    length: day.length! * 7,
    start(d, o) {
        const s = _startOfDay(d, o);
        s.setDate(s.getDate() - s.getDay());
        return s;
    },
    step: (d, n) => d.setDate(d.getDate() + n * 7),
};

const year: Period = {
    names: ['y', 'yr', 'year?s'],
    length: day.length! * (365 * 400 + 97) / 400,
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
            const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
            d.setTime(d.getTime() + f * (isLeap(d.getFullYear()) ? 366 : 365) * 24 * 60 * 60 * 1000);
        }
    },
};

const month: Period = {
    names: ['M', 'mo', 'month?s'],
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

const quarter: Period = {
    names: ['q', 'quarter?s'],
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

const semiMonth: Period = {
    names: ['sm', 'semi-month?s', 'semimonth?s'],
    length: month.length! / 2,
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
        if (f) d.setTime(d.getTime() + f * month.length! / 2);
    },
};

const bd: Period = { names: ['bd', 'bday?s', 'business day?s'], step: _stepBusinessDays };
const bh: Period = { names: ['bh', 'bhour?s', 'business hour?s'], step: _stepBusinessHours };

const fy: Period = {
    names: ['fy', 'fiscal year?s', 'fiscal-year?s'],
    length: year.length,
    start: _startOfFiscalYear,
    step: (d, n) => d.setFullYear(d.getFullYear() + n),
};

const fq: Period = {
    names: ['fq', 'fiscal quarter?s', 'fiscal-quarter?s'],
    length: year.length! / 4,
    start(d, o) {
        const s = _startOfFiscalYear(d, o);
        const monthsIn = (_startOfDay(d, o).getMonth() - s.getMonth() + 12) % 12;
        s.setMonth(s.getMonth() + Math.floor(monthsIn / 3) * 3);
        return s;
    },
    step: (d, n) => d.setMonth(d.getMonth() + n * 3),
};

const now: Constant = { names: ['~', 'now'], anchor: null, resolve: o => _getNow(o) };
const today: Constant = { names: ['today'], anchor: 'day', resolve: o => _startOfDay(_getNow(o), o) };
const yesterday: Constant = {
    names: ['yesterday'], anchor: 'day', resolve: o => {
        const d = _startOfDay(_getNow(o), o);
        d.setDate(d.getDate() - 1);
        return d;
    },
};
const tomorrow: Constant = {
    names: ['tomorrow'], anchor: 'day', resolve: o => {
        const d = _startOfDay(_getNow(o), o);
        d.setDate(d.getDate() + 1);
        return d;
    },
};

export const WeekdayPeriods: Plugin = {
    periods: Object.fromEntries(
        ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((short, i) => {
            const long = new Intl.DateTimeFormat('en-US', { weekday: 'long' })
                .format(new Date(2024, 0, 7 + i)).toLowerCase();
            return [short, {
                names: [short, long],
                length: week.length,
                start(d: Date, o: Parameters<typeof _startOfDay>[1]) {
                    const s = _startOfDay(d, o);
                    s.setDate(s.getDate() - (s.getDay() - i + 7) % 7);
                    return s;
                },
                step: (d: Date, n: number) => d.setDate(d.getDate() + n * 7),
            } satisfies Period];
        })
    ),
};

export const CorePeriods: Plugin = { periods: { ms, second, minute, hour, day, week, month, semiMonth, quarter, year } };
export const BusinessPeriods: Plugin = { periods: { bd, bh } };
export const FiscalPeriods: Plugin = { periods: { fy, fq } };
export const CoreConstants: Plugin = { constants: { now, today, yesterday, tomorrow } };
export const CoreTimeNames: Plugin = { timeNames: { midnight: [0, 0, 0], noon: [12, 0, 0], eod: [23, 59, 59] } };

export const Standard: Plugin[] = [CorePeriods, WeekdayPeriods, CoreConstants, CoreTimeNames];
