import { configDefaults, defineConfig } from 'vitest/config';

// mobile/ is a separate Expo project with its own jest suite.
export default defineConfig({ test: { exclude: [...configDefaults.exclude, 'mobile/**'] } });
