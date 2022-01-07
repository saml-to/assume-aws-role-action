import { getInput, setOutput } from '@actions/core';
import { STS } from '@aws-sdk/client-sts';
import axios from 'axios';
import {
  Configuration,
  IDPApi,
  GithubSlsRestApiSamlResponseContainer,
  GithubSlsRestApiAwsAssumeSdkOptions,
} from '../api/github-sls-rest-api';

export class Action {
  async run(): Promise<void> {
    const token = getInput('token', { required: true });
    const role = getInput('role', { required: true });
    const provider = getInput('provider', { required: true });
    console.log(`Assuming ${role} (provider: ${provider})`);

    const githubRepository = process.env.GITHUB_REPOSITORY;
    if (!githubRepository) {
      throw new Error('Missing GITHUB_REPOSITORY environment variable');
    }
    const [org, repo] = githubRepository.split('/');
    if (!org || !repo) {
      throw new Error(
        `Unalbe to parse owner and repo from GITHUB_REPOSITORY environment variable: ${githubRepository}`,
      );
    }

    const api = new IDPApi(new Configuration({ accessToken: token }));

    try {
      const { data: response } = await api.assumeRoleForRepo(org, repo, role, provider);
      await this.assumeAws(response);
    } catch (e) {
      if (axios.isAxiosError(e)) {
        let message = e.message;
        if (e.response && e.response.data && e.response.data.message) {
          message = e.response.data.message;
        }
        throw new Error(`Unable to assume role: ${message}`);
      }
      throw e;
    }
  }

  async assumeAws(response: GithubSlsRestApiSamlResponseContainer): Promise<void> {
    const sts = new STS({});
    const opts = response.sdkOptions as GithubSlsRestApiAwsAssumeSdkOptions;
    if (!opts) {
      throw new Error('Missing sdk options from saml response');
    }
    const assumeResponse = await sts.assumeRoleWithSAML({
      ...opts,
      SAMLAssertion: response.samlResponse,
    });
    console.log('!!! assumeResponse', JSON.stringify(assumeResponse));
    if (
      !assumeResponse.Credentials ||
      !assumeResponse.Credentials.AccessKeyId ||
      !assumeResponse.Credentials.SecretAccessKey ||
      !assumeResponse.Credentials.SessionToken
    ) {
      throw new Error('Missing credentials');
    }
    setOutput('accessKeyId', assumeResponse.Credentials.AccessKeyId);
    setOutput('secretAccessKey', assumeResponse.Credentials.SecretAccessKey);
    setOutput('sessionToken', assumeResponse.Credentials.SessionToken);
  }
}
