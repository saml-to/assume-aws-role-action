import { Action } from './action';
import { setFailed } from '@actions/core';

(async () => {
  try {
    const action = new Action();
    await action.run();
  } catch (e) {
    if (e instanceof Error) {
      console.error(`Error: ${e.message}`);
      setFailed(e.message);
      return;
    }
    throw e;
  }
  process.exit(0);
})();
