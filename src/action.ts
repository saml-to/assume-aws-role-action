import { error, exportVariable, getInput, info, setFailed, setOutput } from '@actions/core';
import { AssumeRoleWithSAMLResponse, STS } from '@aws-sdk/client-sts';
import axios from 'axios';
import {
  Configuration,
  IDPApi,
  GithubSlsRestApiSamlResponseContainer,
  GithubSlsRestApiAwsAssumeSdkOptions,
} from '../api/github-sls-rest-api';

const { GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;

export class Action {
  async run(): Promise<void> {
    if (!GITHUB_TOKEN) {
      setFailed(`Missing GITHUB_TOKEN environment variable`);
      return;
    }

    const role = getInput('role', { required: true });
    const provider = getInput('provider', { required: false });
    const region = getInput('region', { required: false }) || 'us-east-1';
    if (provider) {
      info(`Assuming ${provider} Role: ${role} in ${region}`);
    } else {
      info(`Assuming Role: ${role} in ${region}`);
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

    const api = new IDPApi(new Configuration({ accessToken: GITHUB_TOKEN }));

    try {
      const { data: response } = await api.assumeRoleForRepo(
        org,
        repo,
        role,
        provider || undefined,
      );

      info(`SAML Response generated for login to ${response.provider} via ${response.recipient}`);

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
      if (e && e.Code) {
        error(`AWS IAM couldn't assume the role with an ARN of \`${opts.RoleArn} using the SAML provider with an ARN of \`${opts.PrincipalArn}\`.

Please ensure all of the following:
 1) the SAML Provider ARN (${opts.PrincipalArn}) is correct in the \`saml-to.yml\` configuration file, and in the format of \`arn:aws:iam::ACCOUNT_ID:saml-provider/PROVIDER_NAME\`,
 2) the SAML Provider Metadata (${opts.PrincipalArn}) in AWS IAM is correct. It can be obtained by downloading it from: ${response.issuer}
 3) the Role ARN (${opts.RoleArn}) is correct in the \`saml-to.yml\` configuration file, and in the format of \`arn:aws:iam::ACCOUNT_ID:role/ROLE_NAME\`
 4) the Role (${opts.RoleArn}) has a Trust Relationship with \`${opts.PrincipalArn}\`, which can be found by opening the Role in AWS IAM, choosing the Trust Relationship tab, editing it to ensure it's in the following format:
      {
        "Version": "2012-10-17",
        "Statement": [
          {
            "Effect": "Allow",
            "Principal": {
              "Federated": "${opts.PrincipalArn}"
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
      }
      throw e;
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

    info(
      `Assumed ${opts.RoleArn}: ${callerIdentity.Arn} (Credential expiration at ${assumeResponse.Credentials.Expiration})`,
    );

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
