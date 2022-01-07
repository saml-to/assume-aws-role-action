import { Action } from './action';
import { setFailed } from '@actions/core';

(async () => {
  try {
    const action = new Action();
    await action.run();
  } catch (e) {
    if (e instanceof Error) {
      setFailed(e.message);
      return;
    }
    throw e;
  }
  process.exit(0);
})();
