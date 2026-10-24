import type { Project, TerminalWithState } from '@spark/shared';
import { describe, expect, it } from 'vitest';
import { type ProcessSample, parseCpuTime, parseProcessSamples, ResourceMonitor } from '../src/core/resourceMonitor.js';

function fixture() {
  let at = 10000;
  let failed = false;
  let verifyIdentity = false;
  const project = { id: 'p', terminals: [{ id: 'a' }, { id: 'b' }] } as Project;
  const states = [
    { id: 'a', pid: 10, startedAt: 1, status: 'running' },
    { id: 'b', pid: 20, startedAt: 1, status: 'running' },
  ] as TerminalWithState[];
  const samples: ProcessSample[] = [
    { pid: 10, ppid: 1, pgid: 10, identity: 'first', cpuMs: 1000, memoryBytes: 100, name: 'node' },
    { pid: 11, ppid: 10, pgid: 20, identity: 'child', cpuMs: 1000, memoryBytes: 200, name: 'node' },
    { pid: 20, ppid: 1, pgid: 20, identity: 'second', cpuMs: 1000, memoryBytes: 300, name: 'sh' },
    { pid: 30, ppid: 1, pgid: 30, identity: 'external', cpuMs: 1000, memoryBytes: 900, name: 'outside' },
  ];
  const monitor = new ResourceMonitor(
    { listProjects: () => [project] },
    {
      terminalStates: () => states,
      runningGroups: () =>
        states
          .filter((t) => t.status === 'running')
          .map((t) => ({
            id: 'p',
            terminalId: t.id,
            pgid: t.pid!,
            ...(verifyIdentity ? { identity: `${t.pid} ${t.id === 'a' ? 'first' : 'second'}` } : {}),
          })),
    },
    () => {},
    async () => {
      if (failed) throw new Error('ps failed');
      return samples;
    },
    () => at,
    () => at,
    4,
  );
  return {
    monitor,
    verifyIdentity: () => {
      verifyIdentity = true;
    },
    states,
    samples,
    advance: (ms = 3000) => {
      at += ms;
    },
    fail: (value: boolean) => {
      failed = value;
    },
  };
}

describe('resource monitor', () => {
  it('uses ancestry ownership once, excludes external PIDs, and calculates interval CPU against all cores', async () => {
    const f = fixture();
    const initial = await f.monitor.refresh();
    expect(initial.total).toMatchObject({ memoryBytes: 600, processCount: 3, cpuPercent: null, status: 'collecting' });
    expect(initial.projects[0]!.terminals.map((t) => t.processCount)).toEqual([2, 1]);
    f.advance();
    for (const p of f.samples) p.cpuMs += 3000;
    expect((await f.monitor.refresh()).total).toMatchObject({ status: 'ready', cpuPercent: 75 });
    f.samples[0]!.identity = 'reused';
    f.advance();
    expect((await f.monitor.refresh()).projects[0]!.terminals[0]!.cpuPercent).toBeNull();
  });

  it('does not refresh sample timestamps on reads and rejects a reused root identity', async () => {
    const f = fixture();
    f.verifyIdentity();
    const first = await f.monitor.refresh();
    f.advance();
    expect(f.monitor.read().sampledAt).toBe(first.sampledAt);
    expect(f.monitor.read().total.sampledAt).toBe(first.total.sampledAt);
    f.samples[0]!.identity = 'unrelated';
    expect((await f.monitor.refresh()).projects[0]!.terminals[0]!.status).toBe('unavailable');
  });

  it('resets failure baselines, preserves restart gaps, and clears stopped values immediately', async () => {
    const f = fixture();
    await f.monitor.refresh();
    f.fail(true);
    f.advance();
    expect((await f.monitor.refresh()).total).toMatchObject({
      status: 'unavailable',
      memoryBytes: null,
      cpuPercent: null,
    });
    f.fail(false);
    f.advance();
    expect((await f.monitor.refresh()).total.cpuPercent).toBeNull();
    f.states.forEach((t) => {
      t.status = 'stopped';
    });
    f.monitor.stateChanged();
    expect(f.monitor.history('p').points.at(-1)).toMatchObject({ status: 'stopped', memoryBytes: null });
    f.states[0]!.status = 'running';
    f.states[0]!.pid = 40;
    f.states[0]!.startedAt = 100;
    f.monitor.stateChanged();
    expect(f.monitor.history('p').points.length).toBeGreaterThan(3);
    f.states[0]!.status = 'stopped';
    f.monitor.stateChanged();
    expect(f.monitor.read().projects[0]!.status).toBe('stopped');
    expect(f.monitor.history('p').points.at(-1)?.status).toBe('stopped');
  });

  it('bounds history by time and count and coalesces overlapping requests', async () => {
    const f = fixture();
    const one = f.monitor.refresh();
    expect(f.monitor.refresh()).toBe(one);
    await one;
    for (let i = 0; i < 320; i++) {
      f.advance();
      await f.monitor.refresh();
    }
    expect(f.monitor.history('p').points).toHaveLength(301);
    f.advance(900001);
    expect(f.monitor.history('p').points).toEqual([]);
  });

  it('drops an in-flight result when terminal lifecycle changes', async () => {
    const f = fixture();
    const pending = f.monitor.refresh();
    f.states.forEach((t) => {
      t.status = 'stopped';
    });
    f.monitor.stateChanged();
    expect((await pending).total.status).toBe('stopped');
    expect(f.monitor.history('p').points.at(-1)?.status).toBe('stopped');
  });
});

it('parses BSD and Linux ps cumulative times and returns executable names only', () => {
  expect(parseCpuTime('01:02.50')).toBe(62500);
  expect(parseCpuTime('02:01:02')).toBe(7262000);
  expect(parseCpuTime('1-02:01:02')).toBe(93662000);
  expect(parseProcessSamples(' 12 1 12 4096 01:02.50 Fri Oct 23 10:30:00 2026 /usr/local/bin/node')[0]).toMatchObject({
    pid: 12,
    cpuMs: 62500,
    memoryBytes: 4194304,
    name: 'node',
  });
});

it('normalizes single digit day spacing in process identities', () => {
  expect(parseProcessSamples('12 1 12 4096 00:00.01 Fri Oct  3 10:30:00 2026 /usr/bin/node')[0]!.identity).toBe(
    'Fri Oct 3 10:30:00 2026',
  );
});
