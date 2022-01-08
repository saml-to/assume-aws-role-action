import { error, exportVariable, getInput, info, setFailed, setOutput } from '@actions/core';
import { AssumeRoleWithSAMLResponse, STS } from '@aws-sdk/client-sts';
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
    const provider = getInput('provider', { required: false });
    const region = getInput('region', { required: false }) || 'us-east-1';
    if (provider) {
      info(`Assuming ${provider} Role: ${role} in ${region}`);
    } else {
      info(`Assuming Role: ${role} in ${region}`);
    }

    const githubRepository = process.env.GITHUB_REPOSITORY;
    if (!githubRepository) {
      throw new Error('Missing GITHUB_REPOSITORY environment variable');
    }
    const [org, repo] = githubRepository.split('/');
    if (!org || !repo) {
      throw new Error(
        `Unable to parse owner and repo from GITHUB_REPOSITORY environment variable: ${githubRepository}`,
      );
    }

    const api = new IDPApi(new Configuration({ accessToken: token }));

    try {
      const { data: response } = await api.assumeRoleForRepo(
        org,
        repo,
        role,
        provider || undefined,
      );

      info(`SAML Response generated for ${response.provider} for login via ${response.recipient}`);

      await this.assumeAws(response, region);
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

  async assumeAws(response: GithubSlsRestApiSamlResponseContainer, region: string): Promise<void> {
    const sts = new STS({ region });
    const opts = response.sdkOptions as GithubSlsRestApiAwsAssumeSdkOptions;
    if (!opts) {
      throw new Error('Missing sdk options from saml response');
    }

    let assumeResponse: AssumeRoleWithSAMLResponse;
    try {
      assumeResponse = await sts.assumeRoleWithSAML({
        ...opts,
        SAMLAssertion: response.samlResponse,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (e && e.code && e.code === 'AuthSamlInvalidSamlResponseException') {
        error(e);
        setFailed(
          `Please ensure the Metadata is correct for Identity Provider \`${opts.PrincipalArn}\` in AWS IAM. The Metadata can be downloaded here: ${response.issuer}`,
        );
      } else {
        throw e;
      }
      return;
    }

    if (
      !assumeResponse.Credentials ||
      !assumeResponse.Credentials.AccessKeyId ||
      !assumeResponse.Credentials.SecretAccessKey ||
      !assumeResponse.Credentials.SessionToken
    ) {
      throw new Error('Missing credentials');
    }

    const assumedSts = new STS({
      region,
      credentials: {
        accessKeyId: assumeResponse.Credentials.AccessKeyId,
        secretAccessKey: assumeResponse.Credentials.SecretAccessKey,
        sessionToken: assumeResponse.Credentials.SessionToken,
      },
    });

    const callerIdentity = await assumedSts.getCallerIdentity({});

    info(`Assumed AWS Role: ${callerIdentity.Arn}`);

    exportVariable('AWS_DEFAULT_REGION', region);
    exportVariable('AWS_ACCESS_KEY_ID', assumeResponse.Credentials.AccessKeyId);
    exportVariable('AWS_SECRET_ACCESS_KEY', assumeResponse.Credentials.SecretAccessKey);
    exportVariable('AWS_SESSION_TOKEN', assumeResponse.Credentials.SessionToken);

    setOutput('region', region);
    setOutput('accountId', callerIdentity.Account);
    setOutput('userId', callerIdentity.UserId);
    setOutput('roleArn', opts.RoleArn);
    setOutput('assumedRoleArn', callerIdentity.Arn);
    setOutput('accessKeyId', assumeResponse.Credentials.AccessKeyId);
    setOutput('secretAccessKey', assumeResponse.Credentials.SecretAccessKey);
    setOutput('sessionToken', assumeResponse.Credentials.SessionToken);
  }
}
