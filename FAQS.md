# Frequently Asked Questions

## "I have many repositories that need this action, but creating a SAML Provider in AWS per-repository won't scale. What should I do?"

### Option 1 (Less Secure)

If all repositories need access to the same role, make a new "Shared Provider" (sans the Repository Name) and place that in the various `saml-to.yml` configuration files.

Need more info on this? [Message us on Gitter](https://gitter.im/saml-to/assume-aws-role-action).

### Option 2 (More Secure)

[SAML.to](https://saml.to) allows you to consolidate many `saml-to.yml` configuration files into a single file in a centralized repository.

We're happy to walk you though this process, so [message us on Gitter](https://gitter.im/saml-to/assume-aws-role-action).
