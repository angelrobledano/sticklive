import { createWorkerHandler, type WorkerEnv } from './worker.js';

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return createWorkerHandler(env)(request);
  },
};
