import './expression.js';
import './format.js';

export { Chronos } from './chronos.js';
export {
    CorePeriods,
    BusinessPeriods,
    FiscalPeriods,
    WeekdayPeriods,
    CoreConstants,
    CoreTimeNames,
    Standard,
} from './periods.js';
export type * from './types.js';

import { Chronos } from './chronos.js';
import { Standard, BusinessPeriods, FiscalPeriods } from './periods.js';

export const Time = new Chronos([...Standard, BusinessPeriods, FiscalPeriods]);
