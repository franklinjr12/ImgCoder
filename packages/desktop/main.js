// GameArtisan Desktop (US-8.2): Electron shell around the Studio with native project-folder access.
// Start: `pnpm --filter @game-artisan/desktop start [projectDir]` (requires the optional `electron` dependency).
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import path from 'node:path';
import { loadConfig } from '@game-artisan/runtime';
import { startStudio } from '@game-artisan/studio';

let studio = null;
let win = null;

async function openProject(dir) {
  if (studio) await studio.close();
  const config = await loadConfig({ cwd: dir });
  studio = await startStudio({
    root: config.root,
    entry: config.entry ? path.resolve(config.root, config.entry) : undefined,
    assetsDir: config.assetsDir,
    documentsDir: path.join(config.root, 'designs'),
    fontFiles: (config.fonts?.files ?? []).map((f) => path.resolve(config.root, typeof f === 'string' ? f : f.path)),
    includeBuiltinTemplates: config.includeBuiltinTemplates ?? !config.entry,
    port: 0,
    logLevel: 'silent',
  });
  // The studio dev server watches the project's assets directory and pushes reloads
  // to the canvas when files change on disk (no manual refresh needed).
  win.setTitle(`GameArtisan Studio — ${path.basename(config.root)}`);
  await win.loadURL(studio.url);
}

async function chooseProject() {
  const r = await dialog.showOpenDialog(win, { title: 'Open GameArtisan project folder', properties: ['openDirectory', 'createDirectory'] });
  if (!r.canceled && r.filePaths[0]) await openProject(r.filePaths[0]);
}

app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1600, height: 1000, backgroundColor: '#14141c', webPreferences: { contextIsolation: true } });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'File', submenu: [{ label: 'Open Project Folder…', accelerator: 'CmdOrCtrl+O', click: chooseProject }, { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  );
  const argDir = process.argv.slice(2).find((a) => !a.startsWith('-') && a !== '.');
  if (argDir) await openProject(path.resolve(argDir));
  else await chooseProject();
});

app.on('window-all-closed', async () => {
  await studio?.close();
  app.quit();
});
