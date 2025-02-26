data "aws_partition" "current" {
  count = var.create ? 1 : 0
}
data "aws_caller_identity" "current" {
  count = var.create ? 1 : 0
}

locals {
  account_id = try(data.aws_caller_identity.current[0].account_id, "")
  partition  = try(data.aws_partition.current[0].partition, "")
  dns_suffix = try(data.aws_partition.current[0].dns_suffix, "")
}

################################################################################
# Key
################################################################################

resource "aws_kms_key" "this" {
  count = var.create && !var.create_external && !var.create_replica && !var.create_replica_external ? 1 : 0

  bypass_policy_lockout_safety_check = var.bypass_policy_lockout_safety_check
  customer_master_key_spec           = var.customer_master_key_spec
  custom_key_store_id                = var.custom_key_store_id
  deletion_window_in_days            = var.deletion_window_in_days
  description                        = var.description
  enable_key_rotation                = var.enable_key_rotation
  is_enabled                         = var.is_enabled
  key_usage                          = var.key_usage
  multi_region                       = var.multi_region
  policy                             = coalesce(var.policy, data.aws_iam_policy_document.this[0].json)
  rotation_period_in_days            = var.rotation_period_in_days

  tags = var.tags
}

################################################################################
# External Key
################################################################################

resource "aws_kms_external_key" "this" {
  count = var.create && var.create_external && !var.create_replica && !var.create_replica_external ? 1 : 0

  bypass_policy_lockout_safety_check = var.bypass_policy_lockout_safety_check
  deletion_window_in_days            = var.deletion_window_in_days
  description                        = var.description
  enabled                            = var.is_enabled
  key_material_base64                = var.key_material_base64
  multi_region                       = var.multi_region
  policy                             = coalesce(var.policy, data.aws_iam_policy_document.this[0].json)
  valid_to                           = var.valid_to

  tags = var.tags
}

################################################################################
# Replica Key
################################################################################

resource "aws_kms_replica_key" "this" {
  count = var.create && var.create_replica && !var.create_external && !var.create_replica_external ? 1 : 0

  bypass_policy_lockout_safety_check = var.bypass_policy_lockout_safety_check
  deletion_window_in_days            = var.deletion_window_in_days
  description                        = var.description
  primary_key_arn                    = var.primary_key_arn
  enabled                            = var.is_enabled
  policy                             = coalesce(var.policy, data.aws_iam_policy_document.this[0].json)

  tags = var.tags
}

################################################################################
# Replica External Key
################################################################################

resource "aws_kms_replica_external_key" "this" {
  count = var.create && !var.create_replica && !var.create_external && var.create_replica_external ? 1 : 0

  bypass_policy_lockout_safety_check = var.bypass_policy_lockout_safety_check
  deletion_window_in_days            = var.deletion_window_in_days
  description                        = var.description
  enabled                            = var.is_enabled
  key_material_base64                = var.key_material_base64
  policy                             = coalesce(var.policy, data.aws_iam_policy_document.this[0].json)
  primary_key_arn                    = var.primary_external_key_arn
  valid_to                           = var.valid_to

  tags = var.tags
}

################################################################################
# Policy
################################################################################

data "aws_iam_policy_document" "this" {
  count = var.create ? 1 : 0

  source_policy_documents   = var.source_policy_documents
  override_policy_documents = var.override_policy_documents

  # Default policy - account wide access to all key operations
  dynamic "statement" {
    for_each = var.enable_default_policy ? [1] : []

    content {
      sid       = "Default"
      actions   = ["kms:*"]
      resources = ["*"]

      principals {
        type        = "AWS"
        identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
      }
    }
  }

  # Key owner - all key operations
  dynamic "statement" {
    for_each = length(var.key_owners) > 0 ? [1] : []

    content {
      sid       = "KeyOwner"
      actions   = ["kms:*"]
      resources = ["*"]

      principals {
        type        = "AWS"
        identifiers = var.key_owners
      }
    }
  }

  # Key administrators - https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-default.html#key-policy-default-allow-administrators
  dynamic "statement" {
    for_each = length(var.key_administrators) > 0 ? [1] : []

    content {
      sid = "KeyAdministration"
      actions = [
        "kms:Create*",
        "kms:Describe*",
        "kms:Enable*",
        "kms:List*",
        "kms:Put*",
        "kms:Update*",
        "kms:Revoke*",
        "kms:Disable*",
        "kms:Get*",
        "kms:Delete*",
        "kms:TagResource",
        "kms:UntagResource",
        "kms:ScheduleKeyDeletion",
        "kms:CancelKeyDeletion",
        "kms:ReplicateKey",
        "kms:ImportKeyMaterial"
      ]
      resources = ["*"]

      principals {
        type        = "AWS"
        identifiers = var.key_administrators
      }
    }
  }

  # Key users - https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-default.html#key-policy-default-allow-users
  dynamic "statement" {
    for_each = length(var.key_users) > 0 ? [1] : []

    content {
      sid = "KeyUsage"
      actions = [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:ReEncrypt*",
        "kms:GenerateDataKey*",
        "kms:DescribeKey",
      ]
      resources = ["*"]

      principals {
        type        = "AWS"
        identifiers = var.key_users
      }
    }
  }

  # Key service users - https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-default.html#key-policy-service-integration
  dynamic "statement" {
    for_each = length(var.key_service_users) > 0 ? [1] : []

    content {
      sid = "KeyServiceUsage"
      actions = [
        "kms:CreateGrant",
        "kms:ListGrants",
        "kms:RevokeGrant",
      ]
      resources = ["*"]

      principals {
        type        = "AWS"
        identifiers = var.key_service_users
      }

      condition {
        test     = "Bool"
        variable = "kms:GrantIsForAWSResource"
        values   = [true]
      }
    }
  }

  # Key service roles for autoscaling - https://docs.aws.amazon.com/autoscaling/ec2/userguide/key-policy-requirements-EBS-encryption.html#policy-example-cmk-access
  dynamic "statement" {
    for_each = length(var.key_service_roles_for_autoscaling) > 0 ? [1] : []

    content {
      sid = "KeyServiceRolesASG"
      actions = [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:ReEncrypt*",
        "kms:GenerateDataKey*",
        "kms:DescribeKey",
      ]
      resources = ["*"]

      principals {
        type        = "AWS"
        identifiers = var.key_service_roles_for_autoscaling
      }
    }
  }

  dynamic "statement" {
    for_each = length(var.key_service_roles_for_autoscaling) > 0 ? [1] : []

    content {
      sid = "KeyServiceRolesASGPersistentVol"
      actions = [
        "kms:CreateGrant"
      ]
      resources = ["*"]

      principals {
        type        = "AWS"
        identifiers = var.key_service_roles_for_autoscaling
      }

      condition {
        test     = "Bool"
        variable = "kms:GrantIsForAWSResource"
        values   = [true]
      }
    }
  }

  # Key cryptographic operations - https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-default.html#key-policy-users-crypto
  dynamic "statement" {
    for_each = length(var.key_symmetric_encryption_users) > 0 ? [1] : []

    content {
      sid = "KeySymmetricEncryption"
      actions = [
        "kms:Decrypt",
        "kms:DescribeKey",
        "kms:Encrypt",
        "kms:GenerateDataKey*",
        "kms:ReEncrypt*",
      ]
      resources = ["*"]

      principals {
        type        = "AWS"
        identifiers = var.key_symmetric_encryption_users
      }
    }
  }

  dynamic "statement" {
    for_each = length(var.key_hmac_users) > 0 ? [1] : []

    content {
      sid = "KeyHMAC"
      actions = [
        "kms:DescribeKey",
        "kms:GenerateMac",
        "kms:VerifyMac",
      ]
      resources = ["*"]

      principals {
        type        = "AWS"
        identifiers = var.key_hmac_users
      }
    }
  }

  dynamic "statement" {
    for_each = length(var.key_asymmetric_public_encryption_users) > 0 ? [1] : []

    content {
      sid = "KeyAsymmetricPublicEncryption"
      actions = [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:ReEncrypt*",
        "kms:DescribeKey",
        "kms:GetPublicKey",
      ]
      resources = ["*"]

      principals {
        type        = "AWS"
        identifiers = var.key_asymmetric_public_encryption_users
      }
    }
  }

  dynamic "statement" {
    for_each = length(var.key_asymmetric_sign_verify_users) > 0 ? [1] : []

    content {
      sid = "KeyAsymmetricSignVerify"
      actions = [
        "kms:DescribeKey",
        "kms:GetPublicKey",
        "kms:Sign",
        "kms:Verify",
      ]
      resources = ["*"]

      principals {
        type        = "AWS"
        identifiers = var.key_asymmetric_sign_verify_users
      }
    }
  }

  # https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/access-control-managing-permissions.html#KMS-key-policy-for-DNSSEC
  dynamic "statement" {
    for_each = var.enable_route53_dnssec ? [1] : []

    content {
      sid = "Route53DnssecService"
      actions = [
        "kms:DescribeKey",
        "kms:GetPublicKey",
        "kms:Sign",
      ]
      resources = ["*"]

      principals {
        type        = "Service"
        identifiers = ["dnssec-route53.${local.dns_suffix}"]
      }
    }
  }

  # https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/access-control-managing-permissions.html#KMS-key-policy-for-DNSSEC
  dynamic "statement" {
    for_each = var.enable_route53_dnssec ? [1] : []

    content {
      sid       = "Route53DnssecGrant"
      actions   = ["kms:CreateGrant"]
      resources = ["*"]

      principals {
        type        = "Service"
        identifiers = ["dnssec-route53.${local.dns_suffix}"]
      }

      condition {
        test     = "Bool"
        variable = "kms:GrantIsForAWSResource"
        values   = ["true"]
      }

      dynamic "condition" {
        for_each = var.route53_dnssec_sources

        content {
          test     = "StringEquals"
          variable = "aws:SourceAccount"
          values   = try(condition.value.account_ids, [local.account_id])
        }
      }

      dynamic "condition" {
        for_each = var.route53_dnssec_sources

        content {
          test     = "ArnLike"
          variable = "aws:SourceArn"
          values   = [try(condition.value.hosted_zone_arn, "arn:${local.partition}:route53:::hostedzone/*")]
        }
      }
    }
  }

  dynamic "statement" {
    for_each = var.key_statements

    content {
      sid           = try(statement.value.sid, null)
      actions       = try(statement.value.actions, null)
      not_actions   = try(statement.value.not_actions, null)
      effect        = try(statement.value.effect, null)
      resources     = try(statement.value.resources, null)
      not_resources = try(statement.value.not_resources, null)

      dynamic "principals" {
        for_each = try(statement.value.principals, [])

        content {
          type        = principals.value.type
          identifiers = principals.value.identifiers
        }
      }

      dynamic "not_principals" {
        for_each = try(statement.value.not_principals, [])

        content {
          type        = not_principals.value.type
          identifiers = not_principals.value.identifiers
        }
      }

      dynamic "condition" {
        for_each = try(statement.value.conditions, [])

        content {
          test     = condition.value.test
          values   = condition.value.values
          variable = condition.value.variable
        }
      }
    }
  }
}

################################################################################
# Alias
################################################################################

locals {
  aliases = { for k, v in toset(var.aliases) : k => { name = v } }
}

resource "aws_kms_alias" "this" {
  for_each = { for k, v in merge(local.aliases, var.computed_aliases) : k => v if var.create }

  name          = var.aliases_use_name_prefix ? null : "alias/${each.value.name}"
  name_prefix   = var.aliases_use_name_prefix ? "alias/${each.value.name}-" : null
  target_key_id = try(aws_kms_key.this[0].key_id, aws_kms_external_key.this[0].id, aws_kms_replica_key.this[0].key_id, aws_kms_replica_external_key.this[0].key_id)
}

################################################################################
# Grant
################################################################################

resource "aws_kms_grant" "this" {
  for_each = { for k, v in var.grants : k => v if var.create }

  name              = try(each.value.name, each.key)
  key_id            = try(aws_kms_key.this[0].key_id, aws_kms_external_key.this[0].id, aws_kms_replica_key.this[0].key_id, aws_kms_replica_external_key.this[0].key_id)
  grantee_principal = each.value.grantee_principal
  operations        = each.value.operations

  dynamic "constraints" {
    for_each = length(lookup(each.value, "constraints", {})) == 0 ? [] : [each.value.constraints]

    content {
      encryption_context_equals = try(constraints.value.encryption_context_equals, null)
      encryption_context_subset = try(constraints.value.encryption_context_subset, null)
    }
  }

  retiring_principal    = try(each.value.retiring_principal, null)
  grant_creation_tokens = try(each.value.grant_creation_tokens, null)
  retire_on_delete      = try(each.value.retire_on_delete, null)
}
