import { DEFAULT_SETTINGS, type Project } from '@spark/shared';
import { LogBufferManager } from '../../src/core/logBuffer.js';
import { ProcessManager } from '../../src/core/processManager.js';

const project = JSON.parse(process.argv[2]) as Project;
const pm = new ProcessManager(new LogBufferManager(100), () => {}, process.argv[3]);
pm.start(project, { ...DEFAULT_SETTINGS, shellMode: 'direct' });
setTimeout(async () => {
  await pm.shutdown([project], { ...DEFAULT_SETTINGS, stopProjectsOnExit: process.argv[4] === 'stop' });
  process.exit(0);
}, 400);
