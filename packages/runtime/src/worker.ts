/** Batch worker thread: loads the project once, then renders jobs posted by the parent. */
import { parentPort, workerData } from 'node:worker_threads';
import { ArtisanProject } from './project.js';
import { runJob } from './batch.js';

async function main() {
  let project: ArtisanProject;
  try {
    project = await ArtisanProject.load(workerData ?? {});
    await project.fonts();
  } catch (e) {
    parentPort!.postMessage({ type: 'fatal', error: (e as Error).stack ?? String(e) });
    return;
  }
  parentPort!.on('message', async (msg: any) => {
    if (msg.type !== 'job') return;
    try {
      const r = await runJob(project, msg.job, workerData?.renderer);
      const { buffer, ...rest } = r;
      parentPort!.postMessage({ type: 'result', job: msg.job, result: rest });
    } catch (e) {
      parentPort!.postMessage({ type: 'error', job: msg.job, error: (e as Error).message ?? String(e) });
    }
  });
  parentPort!.postMessage({ type: 'ready' });
}

void main();
