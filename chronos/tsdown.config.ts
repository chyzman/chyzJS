import { defineConfig } from 'tsdown';

export default defineConfig([
    {
        entry: { chronos: 'src/index.ts' },
        format: ['iife'],
        globalName: 'ChronosLib',
        outExtensions: () => ({ js: '.js' }),
        dts: false,
        outDir: 'dist',
    },
    {
        entry: { 'chronos.esm': 'src/index.ts' },
        format: ['esm'],
        outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
        dts: true,
        outDir: 'dist',
    },
]);
