#!/usr/bin/env node
// `npx game-artisan …` → the artisan CLI.
import { run } from '@game-artisan/cli';

const code = await run(process.argv);
if (code !== 0) process.exit(code);
