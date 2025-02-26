# Complete AWS KMS Example

Configuration in this directory creates:

- Complete KMS key example with key policy, aliases, and grants
- External KMS key example
- Default KMS key example with default policy
- Disable KMS key example

## Usage

To run this example you need to execute:

```bash
$ terraform init
$ terraform plan
$ terraform apply
```

Note that this example may create resources which will incur monetary charges on your AWS bill. Run `terraform destroy` when you no longer need these resources.

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

| Name | Source | Version |
|------|--------|---------|
| <a name="module_kms_complete"></a> [kms\_complete](#module\_kms\_complete) | ../.. | n/a |
| <a name="module_kms_default"></a> [kms\_default](#module\_kms\_default) | ../.. | n/a |
| <a name="module_kms_disabled"></a> [kms\_disabled](#module\_kms\_disabled) | ../.. | n/a |
| <a name="module_kms_dnssec_signing"></a> [kms\_dnssec\_signing](#module\_kms\_dnssec\_signing) | ../.. | n/a |
| <a name="module_kms_external"></a> [kms\_external](#module\_kms\_external) | ../.. | n/a |
| <a name="module_kms_primary"></a> [kms\_primary](#module\_kms\_primary) | ../.. | n/a |
| <a name="module_kms_primary_external"></a> [kms\_primary\_external](#module\_kms\_primary\_external) | ../.. | n/a |
| <a name="module_kms_replica"></a> [kms\_replica](#module\_kms\_replica) | ../.. | n/a |
| <a name="module_kms_replica_external"></a> [kms\_replica\_external](#module\_kms\_replica\_external) | ../.. | n/a |

## Resources

| Name | Type |
|------|------|
| [aws_iam_role.lambda](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_role) | resource |
| [aws_caller_identity.current](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/caller_identity) | data source |
| [aws_region.current](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/region) | data source |

## Inputs

No inputs.

## Outputs

| Name | Description |
|------|-------------|
| <a name="output_complete_aliases"></a> [complete\_aliases](#output\_complete\_aliases) | A map of aliases created and their attributes |
| <a name="output_complete_external_key_expiration_model"></a> [complete\_external\_key\_expiration\_model](#output\_complete\_external\_key\_expiration\_model) | Whether the key material expires. Empty when pending key material import, otherwise `KEY_MATERIAL_EXPIRES` or `KEY_MATERIAL_DOES_NOT_EXPIRE` |
| <a name="output_complete_external_key_state"></a> [complete\_external\_key\_state](#output\_complete\_external\_key\_state) | The state of the CMK |
| <a name="output_complete_external_key_usage"></a> [complete\_external\_key\_usage](#output\_complete\_external\_key\_usage) | The cryptographic operations for which you can use the CMK |
| <a name="output_complete_grants"></a> [complete\_grants](#output\_complete\_grants) | A map of grants created and their attributes |
| <a name="output_complete_key_arn"></a> [complete\_key\_arn](#output\_complete\_key\_arn) | The Amazon Resource Name (ARN) of the key |
| <a name="output_complete_key_id"></a> [complete\_key\_id](#output\_complete\_key\_id) | The globally unique identifier for the key |
| <a name="output_complete_key_policy"></a> [complete\_key\_policy](#output\_complete\_key\_policy) | The IAM resource policy set on the key |
| <a name="output_default_aliases"></a> [default\_aliases](#output\_default\_aliases) | A map of aliases created and their attributes |
| <a name="output_default_external_key_expiration_model"></a> [default\_external\_key\_expiration\_model](#output\_default\_external\_key\_expiration\_model) | Whether the key material expires. Empty when pending key material import, otherwise `KEY_MATERIAL_EXPIRES` or `KEY_MATERIAL_DOES_NOT_EXPIRE` |
| <a name="output_default_external_key_state"></a> [default\_external\_key\_state](#output\_default\_external\_key\_state) | The state of the CMK |
| <a name="output_default_external_key_usage"></a> [default\_external\_key\_usage](#output\_default\_external\_key\_usage) | The cryptographic operations for which you can use the CMK |
| <a name="output_default_grants"></a> [default\_grants](#output\_default\_grants) | A map of grants created and their attributes |
| <a name="output_default_key_arn"></a> [default\_key\_arn](#output\_default\_key\_arn) | The Amazon Resource Name (ARN) of the key |
| <a name="output_default_key_id"></a> [default\_key\_id](#output\_default\_key\_id) | The globally unique identifier for the key |
| <a name="output_default_key_policy"></a> [default\_key\_policy](#output\_default\_key\_policy) | The IAM resource policy set on the key |
| <a name="output_external_aliases"></a> [external\_aliases](#output\_external\_aliases) | A map of aliases created and their attributes |
| <a name="output_external_external_key_expiration_model"></a> [external\_external\_key\_expiration\_model](#output\_external\_external\_key\_expiration\_model) | Whether the key material expires. Empty when pending key material import, otherwise `KEY_MATERIAL_EXPIRES` or `KEY_MATERIAL_DOES_NOT_EXPIRE` |
| <a name="output_external_external_key_state"></a> [external\_external\_key\_state](#output\_external\_external\_key\_state) | The state of the CMK |
| <a name="output_external_external_key_usage"></a> [external\_external\_key\_usage](#output\_external\_external\_key\_usage) | The cryptographic operations for which you can use the CMK |
| <a name="output_external_grants"></a> [external\_grants](#output\_external\_grants) | A map of grants created and their attributes |
| <a name="output_external_key_arn"></a> [external\_key\_arn](#output\_external\_key\_arn) | The Amazon Resource Name (ARN) of the key |
| <a name="output_external_key_id"></a> [external\_key\_id](#output\_external\_key\_id) | The globally unique identifier for the key |
| <a name="output_external_key_policy"></a> [external\_key\_policy](#output\_external\_key\_policy) | The IAM resource policy set on the key |
| <a name="output_replica_aliases"></a> [replica\_aliases](#output\_replica\_aliases) | A map of aliases created and their attributes |
| <a name="output_replica_external_aliases"></a> [replica\_external\_aliases](#output\_replica\_external\_aliases) | A map of aliases created and their attributes |
| <a name="output_replica_external_arn"></a> [replica\_external\_arn](#output\_replica\_external\_arn) | The Amazon Resource Name (ARN) of the key |
| <a name="output_replica_external_grants"></a> [replica\_external\_grants](#output\_replica\_external\_grants) | A map of grants created and their attributes |
| <a name="output_replica_external_key_expiration_model"></a> [replica\_external\_key\_expiration\_model](#output\_replica\_external\_key\_expiration\_model) | Whether the key material expires. Empty when pending key material import, otherwise `KEY_MATERIAL_EXPIRES` or `KEY_MATERIAL_DOES_NOT_EXPIRE` |
| <a name="output_replica_external_key_id"></a> [replica\_external\_key\_id](#output\_replica\_external\_key\_id) | The globally unique identifier for the key |
| <a name="output_replica_external_key_policy"></a> [replica\_external\_key\_policy](#output\_replica\_external\_key\_policy) | The IAM resource policy set on the key |
| <a name="output_replica_external_key_state"></a> [replica\_external\_key\_state](#output\_replica\_external\_key\_state) | The state of the CMK |
| <a name="output_replica_external_key_usage"></a> [replica\_external\_key\_usage](#output\_replica\_external\_key\_usage) | The cryptographic operations for which you can use the CMK |
| <a name="output_replica_grants"></a> [replica\_grants](#output\_replica\_grants) | A map of grants created and their attributes |
| <a name="output_replica_key_arn"></a> [replica\_key\_arn](#output\_replica\_key\_arn) | The Amazon Resource Name (ARN) of the key |
| <a name="output_replica_key_expiration_model"></a> [replica\_key\_expiration\_model](#output\_replica\_key\_expiration\_model) | Whether the key material expires. Empty when pending key material import, otherwise `KEY_MATERIAL_EXPIRES` or `KEY_MATERIAL_DOES_NOT_EXPIRE` |
| <a name="output_replica_key_id"></a> [replica\_key\_id](#output\_replica\_key\_id) | The globally unique identifier for the key |
| <a name="output_replica_key_policy"></a> [replica\_key\_policy](#output\_replica\_key\_policy) | The IAM resource policy set on the key |
| <a name="output_replica_key_state"></a> [replica\_key\_state](#output\_replica\_key\_state) | The state of the CMK |
| <a name="output_replica_key_usage"></a> [replica\_key\_usage](#output\_replica\_key\_usage) | The cryptographic operations for which you can use the CMK |
<!-- END_TF_DOCS -->

Apache-2.0 Licensed. See [LICENSE](https://github.com/terraform-aws-modules/terraform-aws-kms/blob/master/LICENSE).
