import { Action } from './action';
import core from '@actions/core';

(async () => {
  try {
    const command = new Action();
    await command.run();
  } catch (e) {
    if (e instanceof Error) {
      console.error(`Error: ${e.message}`);
      core.setFailed(e.message);
    }
    throw e;
  }
  process.exit(0);
})();
