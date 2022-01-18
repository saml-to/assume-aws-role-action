# assume-aws-role-action

![GitHub release (latest by date)](https://img.shields.io/github/v/release/saml-to/assume-aws-role-action?label=version) ![GitHub issues](https://img.shields.io/github/issues/saml-to/assume-aws-role-action) ![GitHub Workflow Status](https://img.shields.io/github/workflow/status/saml-to/assume-aws-role-action/Push%20to%20Main) ![Gitter](https://img.shields.io/gitter/room/saml-to/assume-aws-role-action)

This action enables workflows to obtain AWS Access Credentials for a desired IAM Role using **AWS IAM SAML** and a **GitHub Actions Repository Token**.

Benefits:

- No need to copy/paste AWS Access Tokens into GitHub Secrets
- No need to rotate AWS Access Tokens

This action uses [SAML.to](https://saml.to) and an [AWS IAM Identity Provider](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_saml.html) to exchange a [GitHub Actions Token](https://docs.github.com/en/actions/security-guides/automatic-token-authentication) for AWS Access Credentials.

This action will set the following environment variables:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN`
- `AWS_DEFAULT_REGION`

## Usage

See [action.yml](action.yml)

```yaml
steps:
  - uses: saml-to/assume-aws-role-action@v1
    with:
      role: arn:aws:iam::123456789012:role/admin
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  - run: aws sts get-caller-identity
  - run: aws ec2 describe-instances
```

## Examples

See [aws-assume-role-action-examples](https://github.com/saml-to/aws-assume-role-action-examples)

## Configuration

1. Create a new **SAML** [Identity Provider](https://console.aws.amazon.com/iamv2/home?#/identity_providers/create) in AWS IAM
   1. **Provider Name**: `saml.to`
   1. **Metadata Document**: Download metadata from [here](https://saml.to/metadata).
   1. Make note of the **`Provder ARN`** in the AWS console
1. Create or update the [Trust Relationship](https://docs.aws.amazon.com/directoryservice/latest/admin-guide/edit_trust.html) on a new or existing IAM Role to contain the following:
   ```
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Federated": "PROVIDER_ARN"
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
   ```
   - Replace `PROVIDER_ARN` with the newly created ARN of the provider, e.g. `arn:aws:iam::123456789012:saml-provider/saml.to`
   - Make note of the **`Role ARN`** for this Role
1. Add a new file named _`saml-to.yml`_ to the repository that needs AWS Access Credentials during GitHub Actions:

   `your-repository/saml-to.yml`:

   ```
   ---
   version: "20220101"
   variables:
     awsProviderArn: "PROVIDER_ARN"
     awsRoleArn: "ROLE_ARN"
   providers:
     aws:
       entityId: https://signin.aws.amazon.com/saml
       acsUrl: https://signin.aws.amazon.com/saml
       attributes:
         https://aws.amazon.com/SAML/Attributes/RoleSessionName: "<#= repo.name #>"
         https://aws.amazon.com/SAML/Attributes/SessionDuration: "3600"
         https://aws.amazon.com/SAML/Attributes/Role: "<#= repo.selectedRole #>,<$= awsProviderArn $>"
   permissions:
     aws:
       roles:
         - name: <$= awsRoleArn $>
           self: true
   ```

   - Replace `PROVIDER_ARN` with the ARN of the provider created above (e.g. `arn:aws:iam::123456689012:saml-provider/saml.to`)
   - Replace `ROLE_ARN` with the ARN of the IAM Role modified above. (e.g. `arn:aws:iam::123456689012:role/admin`)

1. Modify the GitHub Action Workflow to obtain AWS Access Credentials

   `your-repository/.github/workflows/action-name.yml`:

   ```
      jobs:
        prerelease:
          runs-on: ubuntu-latest
          steps:
            - uses: actions/checkout@v2
            ...
            - uses: saml-to/assume-aws-role@v1
              env:
                GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
              with:
                role: "ROLE_ARN"
            ...
   ```

   - Replace `ROLE_ARN` with the ARN of the IAM Role modified above. (e.g. `arn:aws:iam::123456689012:role/admin`)

## Inputs

### `role` (**Required**)

The ARN of the role to assume. This Role ARN must also be defined in the `saml-to.yml` configuration file under `permissions`.

### `region` (_Optional_)

The AWS Region to use. This will also be set as the `AWS_DEFAULT_REGION` environment variable and the `region` output.

**Default**: `us-east-1`

### `provider` (_Optional_)

If there are multiple `provider` entries in the `saml-to.yml` configuration file, set a specific provider.

**Note**: If multiple providers are configured, and this is absent, the Action will fail.

**Default**: `` (_Empty String_)

## Outputs

### `region`

The AWS Region authenitcated with (default: `us-east-1`)

Can be modified with the `region` input.

This will also be set in the `AWS_DEFAULT_REGION` environment variable.

### `accountId`

The AWS Account ID authenticated with (e.g. `123456789012`)

### `userId`

The ephemeral user ID (e.g. `AROAYOAAAAAAAAAAAAAAA:my-repository`)

### `roleArn`

The ARN of the Role.

It will be identical to the `role` input.

### `assumedRoleArn`

The effective ARN of the Assumed Role (e.g. `arn:aws:sts::123456789012:assumed-role/admin/my-repository`)

### `accessKeyId`

The generated AWS Access Key ID.

This is also be set in the `AWS_ACCESS_KEY_ID` environment variable.

### `secretAccessKey`

The generated AWS Secret Access Key.

This is also be set in the `AWS_SECRET_ACCESS_KEY` environment variable.

### `sessionToken`

The generated AWS Session Toke.

This is also be set in the `AWS_SESSION_TOKEN` environment variable.

## Advanced Configuration

See [Advanced](ADVANCED.md)

## Maintainers

- [Scaffoldly](https://github.com/scaffoldly)
- [cnuss](https://github.com/cnuss)

## Help & Support

- [Gitter](https://gitter.im/saml-to/assume-aws-role-action)
- [Support via Twitter](https://twitter.com/SamlToSupport)
- [Discussions](https://github.com/saml-to/assume-aws-role-action/discussions)

## License

[Apache-2.0 License](LICENSE)
