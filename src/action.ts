import {
  error,
  exportVariable,
  getInput,
  info,
  setFailed,
  setOutput,
  warning,
} from '@actions/core';
import { STS } from '@aws-sdk/client-sts';
import axios from 'axios';
import {
  Configuration,
  IDPApi,
  GithubSlsRestApiSamlResponseContainer,
  GithubSlsRestApiAwsAssumeSdkOptions,
} from '../api/github-sls-rest-api';

const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, SAML_TO_NONLIVE, SAML_TO_API_KEY } =
  process.env;

export class Action {
  async run(): Promise<void> {
    if (!GITHUB_TOKEN) {
      setFailed(`Missing GITHUB_TOKEN environment variable`);
      return;
    }

    if (!GITHUB_REPOSITORY) {
      throw new Error('Missing GITHUB_REPOSITORY environment variable');
    }

    const [org, repo] = GITHUB_REPOSITORY.split('/');
    if (!org || !repo) {
      throw new Error(
        `Unable to parse owner and repo from GITHUB_REPOSITORY environment variable: ${GITHUB_REPOSITORY}`,
      );
    }

    const role = getInput('role', { required: true });
    const provider = getInput('provider', { required: false });
    const region = getInput('region', { required: false }) || 'us-east-1';
    const configOwner = getInput('configOwner', { required: false }) || org;

    if (provider) {
      info(`Assuming ${provider} Role: ${role} in ${region}`);
    } else {
      info(`Assuming Role: ${role} in ${region}`);
    }

    const configuration = new Configuration({ accessToken: GITHUB_TOKEN });
    if (SAML_TO_NONLIVE) {
      configuration.basePath = 'https://sso-nonlive.saml.to/github';
      configuration.apiKey = SAML_TO_API_KEY;
    }

    const api = new IDPApi(configuration);

    let sdkOpts: GithubSlsRestApiAwsAssumeSdkOptions | undefined;

    try {
      const { data: response } = await api.assumeRoleForRepo(
        org,
        repo,
        role,
        provider || undefined,
        GITHUB_SHA,
        configOwner,
      );

      info(`SAML Response generated for login to ${response.provider} via ${response.recipient}`);

      sdkOpts = response.sdkOptions;

      if (response.attributes && Object.keys(response.attributes).length) {
        info(`
SAML Attributes:`);
        Object.entries(response.attributes).forEach(([k, v]) => info(` - ${k}: ${v}`));
      }

      await this.assumeAws(response, region);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      const providerHint = sdkOpts ? ` (${sdkOpts.PrincipalArn}) ` : ' ';
      error(`Unable to assume the role with an ARN of \`${role}\`${
        provider ? ` (with explicitly specified provider: ${provider})` : ''
      }.

Please ensure all of the following:
 1) the SAML Provider Metadata${providerHint}in AWS IAM is correct. It can be obtained by downloading it from: https://saml.to/metadata/github/${org}
 2) the SAML Provider ARN${providerHint}is correct in the \`saml-to.yml\` configuration file, and in the format of \`arn:aws:iam::ACCOUNT_ID:saml-provider/PROVIDER_NAME\`,
 3) the Role ARN (${role}) is correct in the \`saml-to.yml\` configuration file, and in the format of \`arn:aws:iam::ACCOUNT_ID:role/ROLE_NAME\`
 4) the Role (${role}) has the correct Trust Relationship ${
        sdkOpts ? `with ${sdkOpts.PrincipalArn}` : ``
      }, which can be found by opening the Role in AWS IAM, choosing the Trust Relationship tab, editing it to ensure it's in the following format:
      {
        "Version": "2012-10-17",
        "Statement": [
          {
            "Effect": "Allow",
            "Principal": {
              "Federated": "${sdkOpts ? sdkOpts.PrincipalArn : 'YOUR_PROVIDER_ARN'}"
            },
            "Action": "sts:AssumeRoleWithSAML",
            "Condition": {
              "StringEquals": {
                "SAML:aud": "https://signin.aws.amazon.com/saml"
              }
            }
          }
        ]
      }
 
If a provider or role hasn't been created or configured yet, please follow the configuration instructions: https://github.com/saml-to/assume-aws-role-action/blob/main/README.md#configuration`);
      if (axios.isAxiosError(e)) {
        let message = e.message;
        if (e.response && e.response.data && e.response.data.message) {
          message = e.response.data.message;
        }

        if (e.response && e.response.status === 403) {
          const { data } = e.response;
          if (data) {
            const { context } = data;
            if (context && context.org && context.repo && context.configFile) {
              if (context.repo !== repo) {
                warning(`The SAML.to configuration for \`${org}\` is managed in a separate repository:
  User/Org: ${context.org}
  Repo: ${context.repo}
  File: ${context.configFile}

Provider configuration and role permissions must be made there.

For more information on configuration files managed in a separate repository, visit:
https://docs.saml.to/usage/github-actions/assume-aws-role-action#centrally-managed-configuration
`);
              }
            }
          }
        }

        throw new Error(`Error: ${message}`);
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

    const assumeResponse = await sts.assumeRoleWithSAML({
      ...opts,
      SAMLAssertion: response.samlResponse,
    });

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

    info(`
Assumed ${opts.RoleArn}: ${callerIdentity.Arn} (Credential expiration at ${assumeResponse.Credentials.Expiration})`);

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
