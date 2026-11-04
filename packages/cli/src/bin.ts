#!/usr/bin/env node
import { run } from './index.js';

const code = await run(process.argv);
// Long-running commands (studio, serve, mcp) keep the event loop alive themselves.
if (code !== 0) process.exit(code);
