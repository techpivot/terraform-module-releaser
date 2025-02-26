################################################################################
# Complete
################################################################################

output "complete_key_arn" {
  description = "The Amazon Resource Name (ARN) of the key"
  value       = module.kms_complete.key_arn
}

output "complete_key_id" {
  description = "The globally unique identifier for the key"
  value       = module.kms_complete.key_id
}

output "complete_key_policy" {
  description = "The IAM resource policy set on the key"
  value       = module.kms_complete.key_policy
}

output "complete_external_key_expiration_model" {
  description = "Whether the key material expires. Empty when pending key material import, otherwise `KEY_MATERIAL_EXPIRES` or `KEY_MATERIAL_DOES_NOT_EXPIRE`"
  value       = module.kms_complete.external_key_expiration_model
}

output "complete_external_key_state" {
  description = "The state of the CMK"
  value       = module.kms_complete.external_key_state
}

output "complete_external_key_usage" {
  description = "The cryptographic operations for which you can use the CMK"
  value       = module.kms_complete.external_key_usage
}

output "complete_aliases" {
  description = "A map of aliases created and their attributes"
  value       = module.kms_complete.aliases
}

output "complete_grants" {
  description = "A map of grants created and their attributes"
  value       = module.kms_complete.grants
}

################################################################################
# External
################################################################################

output "external_key_arn" {
  description = "The Amazon Resource Name (ARN) of the key"
  value       = module.kms_external.key_arn
}

output "external_key_id" {
  description = "The globally unique identifier for the key"
  value       = module.kms_external.key_id
}

output "external_key_policy" {
  description = "The IAM resource policy set on the key"
  value       = module.kms_external.key_policy
}

output "external_external_key_expiration_model" {
  description = "Whether the key material expires. Empty when pending key material import, otherwise `KEY_MATERIAL_EXPIRES` or `KEY_MATERIAL_DOES_NOT_EXPIRE`"
  value       = module.kms_external.external_key_expiration_model
}

output "external_external_key_state" {
  description = "The state of the CMK"
  value       = module.kms_external.external_key_state
}

output "external_external_key_usage" {
  description = "The cryptographic operations for which you can use the CMK"
  value       = module.kms_external.external_key_usage
}

output "external_aliases" {
  description = "A map of aliases created and their attributes"
  value       = module.kms_external.aliases
}

output "external_grants" {
  description = "A map of grants created and their attributes"
  value       = module.kms_external.grants
}

################################################################################
# Default
################################################################################

output "default_key_arn" {
  description = "The Amazon Resource Name (ARN) of the key"
  value       = module.kms_default.key_arn
}

output "default_key_id" {
  description = "The globally unique identifier for the key"
  value       = module.kms_default.key_id
}

output "default_key_policy" {
  description = "The IAM resource policy set on the key"
  value       = module.kms_default.key_policy
}

output "default_external_key_expiration_model" {
  description = "Whether the key material expires. Empty when pending key material import, otherwise `KEY_MATERIAL_EXPIRES` or `KEY_MATERIAL_DOES_NOT_EXPIRE`"
  value       = module.kms_default.external_key_expiration_model
}

output "default_external_key_state" {
  description = "The state of the CMK"
  value       = module.kms_default.external_key_state
}

output "default_external_key_usage" {
  description = "The cryptographic operations for which you can use the CMK"
  value       = module.kms_default.external_key_usage
}

output "default_aliases" {
  description = "A map of aliases created and their attributes"
  value       = module.kms_default.aliases
}

output "default_grants" {
  description = "A map of grants created and their attributes"
  value       = module.kms_default.grants
}


################################################################################
# Replica
################################################################################

output "replica_key_arn" {
  description = "The Amazon Resource Name (ARN) of the key"
  value       = module.kms_replica.key_arn
}

output "replica_key_id" {
  description = "The globally unique identifier for the key"
  value       = module.kms_replica.key_id
}

output "replica_key_policy" {
  description = "The IAM resource policy set on the key"
  value       = module.kms_replica.key_policy
}

output "replica_key_expiration_model" {
  description = "Whether the key material expires. Empty when pending key material import, otherwise `KEY_MATERIAL_EXPIRES` or `KEY_MATERIAL_DOES_NOT_EXPIRE`"
  value       = module.kms_replica.external_key_expiration_model
}

output "replica_key_state" {
  description = "The state of the CMK"
  value       = module.kms_replica.external_key_state
}

output "replica_key_usage" {
  description = "The cryptographic operations for which you can use the CMK"
  value       = module.kms_replica.external_key_usage
}

output "replica_aliases" {
  description = "A map of aliases created and their attributes"
  value       = module.kms_replica.aliases
}

output "replica_grants" {
  description = "A map of grants created and their attributes"
  value       = module.kms_replica.grants
}


################################################################################
# Replica External
################################################################################

output "replica_external_arn" {
  description = "The Amazon Resource Name (ARN) of the key"
  value       = module.kms_replica_external.key_arn
}

output "replica_external_key_id" {
  description = "The globally unique identifier for the key"
  value       = module.kms_replica_external.key_id
}

output "replica_external_key_policy" {
  description = "The IAM resource policy set on the key"
  value       = module.kms_replica_external.key_policy
}

output "replica_external_key_expiration_model" {
  description = "Whether the key material expires. Empty when pending key material import, otherwise `KEY_MATERIAL_EXPIRES` or `KEY_MATERIAL_DOES_NOT_EXPIRE`"
  value       = module.kms_replica_external.external_key_expiration_model
}

output "replica_external_key_state" {
  description = "The state of the CMK"
  value       = module.kms_replica_external.external_key_state
}

output "replica_external_key_usage" {
  description = "The cryptographic operations for which you can use the CMK"
  value       = module.kms_replica_external.external_key_usage
}

output "replica_external_aliases" {
  description = "A map of aliases created and their attributes"
  value       = module.kms_replica_external.aliases
}

output "replica_external_grants" {
  description = "A map of grants created and their attributes"
  value       = module.kms_replica_external.grants
}
