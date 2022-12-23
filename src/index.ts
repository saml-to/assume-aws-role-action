import { Action } from './action';
import { setFailed, notice } from '@actions/core';

(async () => {
  try {
    const action = new Action();
    await action.run();
  } catch (e) {
    if (e instanceof Error) {
      setFailed(e.message);
      notice(`Need help? https://docs.saml.to/troubleshooting/get-help`);
      return;
    }
    throw e;
  }
  process.exit(0);
})();
