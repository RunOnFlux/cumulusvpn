/** Overlap-safe periodic loop with error containment. */
import type { FastifyBaseLogger } from 'fastify';

export interface LoopHandle {
  stop(): void;
}

export function startLoop(
  name: string,
  intervalMs: number,
  log: FastifyBaseLogger,
  fn: () => Promise<void>,
): LoopHandle {
  let stopped = false;
  let timer: NodeJS.Timeout;
  const tick = async (): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      log.error({ err: e }, `${name}: tick failed`);
    }
    if (!stopped) {
      timer = setTimeout(tick, intervalMs);
      timer.unref();
    }
  };
  timer = setTimeout(tick, 0);
  timer.unref();
  return {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
