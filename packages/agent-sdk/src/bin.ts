#!/usr/bin/env node
/** `artisan-mcp` — stdio MCP server for the project in the current directory. */
import { createAgentContext } from './tools.js';
import { runStdioServer } from './mcp.js';

const ctx = await createAgentContext({ cwd: process.env.ARTISAN_PROJECT ?? process.cwd() });
await runStdioServer(ctx);
