################################################################################
# Key
################################################################################

output "key_arn" {
  description = "The Amazon Resource Name (ARN) of the key"
  value       = try(aws_kms_key.this[0].arn, aws_kms_external_key.this[0].arn, aws_kms_replica_key.this[0].arn, aws_kms_replica_external_key.this[0].arn, null)
}

output "key_id" {
  description = "The globally unique identifier for the key"
  value       = try(aws_kms_key.this[0].key_id, aws_kms_external_key.this[0].id, aws_kms_replica_key.this[0].key_id, aws_kms_replica_external_key.this[0].key_id, null)
}

output "key_policy" {
  description = "The IAM resource policy set on the key"
  value       = try(aws_kms_key.this[0].policy, aws_kms_external_key.this[0].policy, aws_kms_replica_key.this[0].policy, aws_kms_replica_external_key.this[0].policy, null)
}

output "external_key_expiration_model" {
  description = "Whether the key material expires. Empty when pending key material import, otherwise `KEY_MATERIAL_EXPIRES` or `KEY_MATERIAL_DOES_NOT_EXPIRE`"
  value       = try(aws_kms_external_key.this[0].expiration_model, aws_kms_replica_external_key.this[0].expiration_model, null)
}

output "external_key_state" {
  description = "The state of the CMK"
  value       = try(aws_kms_external_key.this[0].key_state, aws_kms_replica_external_key.this[0].key_state, null)
}

output "external_key_usage" {
  description = "The cryptographic operations for which you can use the CMK"
  value       = try(aws_kms_external_key.this[0].key_usage, aws_kms_replica_external_key.this[0].key_usage, null)
}

################################################################################
# Alias
################################################################################

output "aliases" {
  description = "A map of aliases created and their attributes"
  value       = aws_kms_alias.this
}

################################################################################
# Grant
################################################################################

output "grants" {
  description = "A map of grants created and their attributes"
  value       = aws_kms_grant.this
  sensitive   = true
}
