import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['server/**/*.test.ts'],
        exclude: ['node_modules', 'dist'],
        setupFiles: ['./server/services/__tests__/setup.ts'],
        // Support for ESM modules
        pool: 'forks',
        poolOptions: {
            forks: {
                singleFork: true
            }
        }
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './server')
        }
    }
});
