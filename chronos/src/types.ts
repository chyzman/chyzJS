// ─────────────────────────────────────────────────────────────────────────────
// Chronos — shared type definitions
// ─────────────────────────────────────────────────────────────────────────────

export interface Options {
    now?: Date | number | string;
    weekStart?: number;
    tz?: string;
    fiscalYearStart?: number;
    businessHoursStart?: number;
    businessHoursEnd?: number;
    isHoliday?: (d: Date) => boolean;
    anchor?: Date | number;
}

export interface Period {
    names: string[];
    length?: number;
    start?: (date: Date, opts: Options) => Date;
    step?: (date: Date, n: number, opts: Options) => void;
    _fixed?: boolean;
}

export interface Constant {
    names: string[];
    anchor: string | null;
    resolve: (opts: Options) => Date;
}

export interface Plugin {
    periods?: Record<string, Period>;
    constants?: Record<string, Constant>;
    timeNames?: Record<string, [number, number, number]>;
    defaults?: Partial<Options>;
}
