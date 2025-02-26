# AWS KMS Terraform module

Terraform module which creates AWS KMS resources.

[![SWUbanner](https://raw.githubusercontent.com/vshymanskyy/StandWithUkraine/main/banner2-direct.svg)](https://github.com/vshymanskyy/StandWithUkraine/blob/main/docs/README.md)

## Usage

See [`examples`](https://github.com/terraform-aws-modules/terraform-aws-kms/tree/master/examples) directory for working examples to reference:

### Autoscaling Service Linked Role

Reference usage for EC2 AutoScaling service linked role to launch encrypted EBS volumes:

```hcl
module "kms" {
  source = "terraform-aws-modules/kms/aws"

  description = "EC2 AutoScaling key usage"
  key_usage   = "ENCRYPT_DECRYPT"

  # Policy
  key_administrators                 = ["arn:aws:iam::012345678901:role/admin"]
  key_service_roles_for_autoscaling  = ["arn:aws:iam::012345678901:role/aws-service-role/autoscaling.amazonaws.com/AWSServiceRoleForAutoScaling"]

  # Aliases
  aliases = ["mycompany/ebs"]

  tags = {
    Terraform   = "true"
    Environment = "dev"
  }
}
```

### External Key

Reference usage for external CMK (externally provided encryption material):

```hcl
module "kms" {
  source = "terraform-aws-modules/kms/aws"

  description         = "External key example"
  key_material_base64 = "Wblj06fduthWggmsT0cLVoIMOkeLbc2kVfMud77i/JY="
  valid_to            = "2085-04-12T23:20:50.52Z"

  # Policy
  key_owners         = ["arn:aws:iam::012345678901:role/owner"]
  key_administrators = ["arn:aws:iam::012345678901:role/admin"]
  key_users          = ["arn:aws:iam::012345678901:role/user"]
  key_service_users  = ["arn:aws:iam::012345678901:role/ec2-role"]

  # Aliases
  aliases                 = ["mycompany/external"]
  aliases_use_name_prefix = true

  # Grants
  grants = {
    lambda = {
      grantee_principal = "arn:aws:iam::012345678901:role/lambda-function"
      operations        = ["Encrypt", "Decrypt", "GenerateDataKey"]
      constraints = {
        encryption_context_equals = {
          Department = "Finance"
        }
      }
    }
  }

  tags = {
    Terraform   = "true"
    Environment = "dev"
  }
}
```

### Reference

Reference usage showing available configurations.

```hcl
module "kms" {
  source = "terraform-aws-modules/kms/aws"

  description             = "Complete key example showing various configurations available"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  is_enabled              = true
  key_usage               = "ENCRYPT_DECRYPT"
  multi_region            = false

  # Policy
  enable_default_policy                  = true
  key_owners                             = ["arn:aws:iam::012345678901:role/owner"]
  key_administrators                     = ["arn:aws:iam::012345678901:role/admin"]
  key_users                              = ["arn:aws:iam::012345678901:role/user"]
  key_service_users                      = ["arn:aws:iam::012345678901:role/ec2-role"]
  key_symmetric_encryption_users         = ["arn:aws:iam::012345678901:role/symmetric-user"]
  key_hmac_users                         = ["arn:aws:iam::012345678901:role/hmac-user"]
  key_asymmetric_public_encryption_users = ["arn:aws:iam::012345678901:role/asymmetric-public-user"]
  key_asymmetric_sign_verify_users       = ["arn:aws:iam::012345678901:role/sign-verify-user"]

  # Aliases
  aliases = ["one", "foo/bar"] # accepts static strings only
  computed_aliases = {
    ex = {
      # Sometimes you want to pass in an upstream attribute as the name and
      # that conflicts with using `for_each over a `toset()` since the value is not
      # known until after applying. Instead, we can use `computed_aliases` to work
      # around this limitation
      # Reference: https://github.com/hashicorp/terraform/issues/30937
      name = aws_iam_role.lambda.name
    }
  }
  aliases_use_name_prefix = true

  # Grants
  grants = {
    lambda = {
      grantee_principal = "arn:aws:iam::012345678901:role/lambda-function"
      operations        = ["Encrypt", "Decrypt", "GenerateDataKey"]
      constraints = {
        encryption_context_equals = {
          Department = "Finance"
        }
      }
    }
  }

  tags = {
    Terraform   = "true"
    Environment = "dev"
  }
}
```

## Examples

Examples codified under the [`examples`](https://github.com/terraform-aws-modules/terraform-aws-kms/tree/master/examples) are intended to give users references for how to use the module(s) as well as testing/validating changes to the source code of the module. If contributing to the project, please be sure to make any appropriate updates to the relevant examples to allow maintainers to test your changes and to keep the examples up to date for users. Thank you!

- [Complete](https://github.com/terraform-aws-modules/terraform-aws-kms/tree/master/examples/complete)

<!-- BEGIN_TF_DOCS -->
## Requirements

| Name | Version |
|------|---------|
| <a name="requirement_terraform"></a> [terraform](#requirement\_terraform) | >= 1.3 |
| <a name="requirement_aws"></a> [aws](#requirement\_aws) | >= 5.49 |

## Providers

| Name | Version |
|------|---------|
| <a name="provider_aws"></a> [aws](#provider\_aws) | >= 5.49 |

## Modules

No modules.

## Resources

| Name | Type |
|------|------|
| [aws_kms_alias.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/kms_alias) | resource |
| [aws_kms_external_key.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/kms_external_key) | resource |
| [aws_kms_grant.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/kms_grant) | resource |
| [aws_kms_key.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/kms_key) | resource |
| [aws_kms_replica_external_key.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/kms_replica_external_key) | resource |
| [aws_kms_replica_key.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/kms_replica_key) | resource |
| [aws_caller_identity.current](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/caller_identity) | data source |
| [aws_iam_policy_document.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/iam_policy_document) | data source |
| [aws_partition.current](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/partition) | data source |

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|:--------:|
| <a name="input_aliases"></a> [aliases](#input\_aliases) | A list of aliases to create. Note - due to the use of `toset()`, values must be static strings and not computed values | `list(string)` | `[]` | no |
| <a name="input_aliases_use_name_prefix"></a> [aliases\_use\_name\_prefix](#input\_aliases\_use\_name\_prefix) | Determines whether the alias name is used as a prefix | `bool` | `false` | no |
| <a name="input_bypass_policy_lockout_safety_check"></a> [bypass\_policy\_lockout\_safety\_check](#input\_bypass\_policy\_lockout\_safety\_check) | A flag to indicate whether to bypass the key policy lockout safety check. Setting this value to true increases the risk that the KMS key becomes unmanageable | `bool` | `null` | no |
| <a name="input_computed_aliases"></a> [computed\_aliases](#input\_computed\_aliases) | A map of aliases to create. Values provided via the `name` key of the map can be computed from upstream resources | `any` | `{}` | no |
| <a name="input_create"></a> [create](#input\_create) | Determines whether resources will be created (affects all resources) | `bool` | `true` | no |
| <a name="input_create_external"></a> [create\_external](#input\_create\_external) | Determines whether an external CMK (externally provided material) will be created or a standard CMK (AWS provided material) | `bool` | `false` | no |
| <a name="input_create_replica"></a> [create\_replica](#input\_create\_replica) | Determines whether a replica standard CMK will be created (AWS provided material) | `bool` | `false` | no |
| <a name="input_create_replica_external"></a> [create\_replica\_external](#input\_create\_replica\_external) | Determines whether a replica external CMK will be created (externally provided material) | `bool` | `false` | no |
| <a name="input_custom_key_store_id"></a> [custom\_key\_store\_id](#input\_custom\_key\_store\_id) | ID of the KMS Custom Key Store where the key will be stored instead of KMS (eg CloudHSM). | `string` | `null` | no |
| <a name="input_customer_master_key_spec"></a> [customer\_master\_key\_spec](#input\_customer\_master\_key\_spec) | Specifies whether the key contains a symmetric key or an asymmetric key pair and the encryption algorithms or signing algorithms that the key supports. Valid values: `SYMMETRIC_DEFAULT`, `RSA_2048`, `RSA_3072`, `RSA_4096`, `HMAC_256`, `ECC_NIST_P256`, `ECC_NIST_P384`, `ECC_NIST_P521`, or `ECC_SECG_P256K1`. Defaults to `SYMMETRIC_DEFAULT` | `string` | `null` | no |
| <a name="input_deletion_window_in_days"></a> [deletion\_window\_in\_days](#input\_deletion\_window\_in\_days) | The waiting period, specified in number of days. After the waiting period ends, AWS KMS deletes the KMS key. If you specify a value, it must be between `7` and `30`, inclusive. If you do not specify a value, it defaults to `30` | `number` | `null` | no |
| <a name="input_description"></a> [description](#input\_description) | The description of the key as viewed in AWS console | `string` | `null` | no |
| <a name="input_enable_default_policy"></a> [enable\_default\_policy](#input\_enable\_default\_policy) | Specifies whether to enable the default key policy. Defaults to `true` | `bool` | `true` | no |
| <a name="input_enable_key_rotation"></a> [enable\_key\_rotation](#input\_enable\_key\_rotation) | Specifies whether key rotation is enabled. Defaults to `true` | `bool` | `true` | no |
| <a name="input_enable_route53_dnssec"></a> [enable\_route53\_dnssec](#input\_enable\_route53\_dnssec) | Determines whether the KMS policy used for Route53 DNSSEC signing is enabled | `bool` | `false` | no |
| <a name="input_grants"></a> [grants](#input\_grants) | A map of grant definitions to create | `any` | `{}` | no |
| <a name="input_is_enabled"></a> [is\_enabled](#input\_is\_enabled) | Specifies whether the key is enabled. Defaults to `true` | `bool` | `null` | no |
| <a name="input_key_administrators"></a> [key\_administrators](#input\_key\_administrators) | A list of IAM ARNs for [key administrators](https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-default.html#key-policy-default-allow-administrators) | `list(string)` | `[]` | no |
| <a name="input_key_asymmetric_public_encryption_users"></a> [key\_asymmetric\_public\_encryption\_users](#input\_key\_asymmetric\_public\_encryption\_users) | A list of IAM ARNs for [key asymmetric public encryption users](https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-default.html#key-policy-users-crypto) | `list(string)` | `[]` | no |
| <a name="input_key_asymmetric_sign_verify_users"></a> [key\_asymmetric\_sign\_verify\_users](#input\_key\_asymmetric\_sign\_verify\_users) | A list of IAM ARNs for [key asymmetric sign and verify users](https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-default.html#key-policy-users-crypto) | `list(string)` | `[]` | no |
| <a name="input_key_hmac_users"></a> [key\_hmac\_users](#input\_key\_hmac\_users) | A list of IAM ARNs for [key HMAC users](https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-default.html#key-policy-users-crypto) | `list(string)` | `[]` | no |
| <a name="input_key_material_base64"></a> [key\_material\_base64](#input\_key\_material\_base64) | Base64 encoded 256-bit symmetric encryption key material to import. The CMK is permanently associated with this key material. External key only | `string` | `null` | no |
| <a name="input_key_owners"></a> [key\_owners](#input\_key\_owners) | A list of IAM ARNs for those who will have full key permissions (`kms:*`) | `list(string)` | `[]` | no |
| <a name="input_key_service_roles_for_autoscaling"></a> [key\_service\_roles\_for\_autoscaling](#input\_key\_service\_roles\_for\_autoscaling) | A list of IAM ARNs for [AWSServiceRoleForAutoScaling roles](https://docs.aws.amazon.com/autoscaling/ec2/userguide/key-policy-requirements-EBS-encryption.html#policy-example-cmk-access) | `list(string)` | `[]` | no |
| <a name="input_key_service_users"></a> [key\_service\_users](#input\_key\_service\_users) | A list of IAM ARNs for [key service users](https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-default.html#key-policy-service-integration) | `list(string)` | `[]` | no |
| <a name="input_key_statements"></a> [key\_statements](#input\_key\_statements) | A map of IAM policy [statements](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/iam_policy_document#statement) for custom permission usage | `any` | `{}` | no |
| <a name="input_key_symmetric_encryption_users"></a> [key\_symmetric\_encryption\_users](#input\_key\_symmetric\_encryption\_users) | A list of IAM ARNs for [key symmetric encryption users](https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-default.html#key-policy-users-crypto) | `list(string)` | `[]` | no |
| <a name="input_key_usage"></a> [key\_usage](#input\_key\_usage) | Specifies the intended use of the key. Valid values: `ENCRYPT_DECRYPT` or `SIGN_VERIFY`. Defaults to `ENCRYPT_DECRYPT` | `string` | `null` | no |
| <a name="input_key_users"></a> [key\_users](#input\_key\_users) | A list of IAM ARNs for [key users](https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-default.html#key-policy-default-allow-users) | `list(string)` | `[]` | no |
| <a name="input_multi_region"></a> [multi\_region](#input\_multi\_region) | Indicates whether the KMS key is a multi-Region (`true`) or regional (`false`) key. Defaults to `false` | `bool` | `false` | no |
| <a name="input_override_policy_documents"></a> [override\_policy\_documents](#input\_override\_policy\_documents) | List of IAM policy documents that are merged together into the exported document. In merging, statements with non-blank `sid`s will override statements with the same `sid` | `list(string)` | `[]` | no |
| <a name="input_policy"></a> [policy](#input\_policy) | A valid policy JSON document. Although this is a key policy, not an IAM policy, an `aws_iam_policy_document`, in the form that designates a principal, can be used | `string` | `null` | no |
| <a name="input_primary_external_key_arn"></a> [primary\_external\_key\_arn](#input\_primary\_external\_key\_arn) | The primary external key arn of a multi-region replica external key | `string` | `null` | no |
| <a name="input_primary_key_arn"></a> [primary\_key\_arn](#input\_primary\_key\_arn) | The primary key arn of a multi-region replica key | `string` | `null` | no |
| <a name="input_rotation_period_in_days"></a> [rotation\_period\_in\_days](#input\_rotation\_period\_in\_days) | Custom period of time between each rotation date. Must be a number between 90 and 2560 (inclusive) | `number` | `null` | no |
| <a name="input_route53_dnssec_sources"></a> [route53\_dnssec\_sources](#input\_route53\_dnssec\_sources) | A list of maps containing `account_ids` and Route53 `hosted_zone_arn` that will be allowed to sign DNSSEC records | `list(any)` | `[]` | no |
| <a name="input_source_policy_documents"></a> [source\_policy\_documents](#input\_source\_policy\_documents) | List of IAM policy documents that are merged together into the exported document. Statements must have unique `sid`s | `list(string)` | `[]` | no |
| <a name="input_tags"></a> [tags](#input\_tags) | A map of tags to add to all resources | `map(string)` | `{}` | no |
| <a name="input_valid_to"></a> [valid\_to](#input\_valid\_to) | Time at which the imported key material expires. When the key material expires, AWS KMS deletes the key material and the CMK becomes unusable. If not specified, key material does not expire | `string` | `null` | no |

## Outputs

| Name | Description |
|------|-------------|
| <a name="output_aliases"></a> [aliases](#output\_aliases) | A map of aliases created and their attributes |
| <a name="output_external_key_expiration_model"></a> [external\_key\_expiration\_model](#output\_external\_key\_expiration\_model) | Whether the key material expires. Empty when pending key material import, otherwise `KEY_MATERIAL_EXPIRES` or `KEY_MATERIAL_DOES_NOT_EXPIRE` |
| <a name="output_external_key_state"></a> [external\_key\_state](#output\_external\_key\_state) | The state of the CMK |
| <a name="output_external_key_usage"></a> [external\_key\_usage](#output\_external\_key\_usage) | The cryptographic operations for which you can use the CMK |
| <a name="output_grants"></a> [grants](#output\_grants) | A map of grants created and their attributes |
| <a name="output_key_arn"></a> [key\_arn](#output\_key\_arn) | The Amazon Resource Name (ARN) of the key |
| <a name="output_key_id"></a> [key\_id](#output\_key\_id) | The globally unique identifier for the key |
| <a name="output_key_policy"></a> [key\_policy](#output\_key\_policy) | The IAM resource policy set on the key |
<!-- END_TF_DOCS -->

## License

Apache-2.0 Licensed. See [LICENSE](https://github.com/terraform-aws-modules/terraform-aws-kms/blob/master/LICENSE).
