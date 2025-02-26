provider "aws" {
  region = local.region
}

locals {
  region           = "us-east-1"
  name             = "kms-ex-${replace(basename(path.cwd), "_", "-")}"
  current_identity = data.aws_caller_identity.current.arn

  tags = {
    Name       = local.name
    Example    = "complete"
    Repository = "https://github.com/terraform-aws-modules/terraform-aws-kms"
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

################################################################################
# KMS Module
################################################################################

module "kms_complete" {
  source = "../.."

  deletion_window_in_days = 7
  description             = "Complete key example showing various configurations available"
  enable_key_rotation     = false
  is_enabled              = true
  key_usage               = "ENCRYPT_DECRYPT"
  multi_region            = false

  # Policy
  enable_default_policy                  = true
  key_owners                             = [local.current_identity]
  key_administrators                     = [local.current_identity]
  key_users                              = [local.current_identity]
  key_service_users                      = [local.current_identity]
  key_service_roles_for_autoscaling      = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/aws-service-role/autoscaling.amazonaws.com/AWSServiceRoleForAutoScaling"]
  key_symmetric_encryption_users         = [local.current_identity]
  key_hmac_users                         = [local.current_identity]
  key_asymmetric_public_encryption_users = [local.current_identity]
  key_asymmetric_sign_verify_users       = [local.current_identity]
  key_statements = [
    {
      sid = "CloudWatchLogs"
      actions = [
        "kms:Encrypt*",
        "kms:Decrypt*",
        "kms:ReEncrypt*",
        "kms:GenerateDataKey*",
        "kms:Describe*"
      ]
      resources = ["*"]

      principals = [
        {
          type        = "Service"
          identifiers = ["logs.${data.aws_region.current.name}.amazonaws.com"]
        }
      ]

      conditions = [
        {
          test     = "ArnLike"
          variable = "kms:EncryptionContext:aws:logs:arn"
          values = [
            "arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:log-group:*",
          ]
        }
      ]
    }
  ]

  # Aliases
  aliases = ["one", "foo/bar"]
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
      grantee_principal = aws_iam_role.lambda.arn
      operations        = ["Encrypt", "Decrypt", "GenerateDataKey"]
      constraints = {
        encryption_context_equals = {
          Department = "Finance"
        }
      }
    }
  }

  tags = local.tags
}

module "kms_external" {
  source = "../.."

  deletion_window_in_days = 7
  description             = "External key example"
  create_external         = true
  is_enabled              = true
  key_material_base64     = "Wblj06fduthWggmsT0cLVoIMOkeLbc2kVfMud77i/JY="
  multi_region            = false
  valid_to                = "2023-11-21T23:20:50Z"

  tags = local.tags
}

module "kms_dnssec_signing" {
  source = "../.."

  description = "CMK for Route53 DNSSEC signing"

  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "ECC_NIST_P256"

  enable_route53_dnssec = true
  enable_key_rotation   = false
  route53_dnssec_sources = [
    {
      accounts_ids    = [data.aws_caller_identity.current.account_id] # can ommit if using current account ID which is default
      hosted_zone_arn = "arn:aws:route53:::hostedzone/*"              # can ommit, this is default value
    }
  ]

  aliases = ["route53/dnssec-ex"]

  tags = local.tags
}

module "kms_default" {
  source = "../.."

  tags = local.tags
}

module "kms_disabled" {
  source = "../.."

  create = false
}

################################################################################
# Replica Key Example
################################################################################

module "kms_primary" {
  source = "../.."

  deletion_window_in_days = 7
  description             = "Primary key of replica key example"
  enable_key_rotation     = false
  is_enabled              = true
  key_usage               = "ENCRYPT_DECRYPT"
  multi_region            = true

  aliases = ["primary-standard"]

  tags = local.tags
}

provider "aws" {
  region = "eu-west-1"
  alias  = "replica"
}

module "kms_replica" {
  source = "../.."

  deletion_window_in_days = 7
  description             = "Replica key example showing various configurations available"
  create_replica          = true
  primary_key_arn         = module.kms_primary.key_arn
  enable_default_policy   = true

  key_owners         = [local.current_identity]
  key_administrators = [local.current_identity]
  key_users          = [local.current_identity]

  # Aliases
  aliases = ["replica-standard"]
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

  # Grants
  grants = {
    lambda = {
      grantee_principal = aws_iam_role.lambda.arn
      operations        = ["Encrypt", "Decrypt", "GenerateDataKey"]
      constraints = {
        encryption_context_equals = {
          Department = "Finance"
        }
      }
    }
  }

  tags = local.tags

  providers = {
    aws = aws.replica
  }
}

################################################################################
# Replica External Key Example
################################################################################

module "kms_primary_external" {
  source = "../.."

  deletion_window_in_days = 7
  description             = "Primary external key of replica external key example"
  is_enabled              = true
  create_external         = true
  key_material_base64     = "Wblj06fduthWggmsT0cLVoIMOkeLbc2kVfMud77i/JY="
  multi_region            = true
  valid_to                = "2023-11-21T23:20:50Z"

  aliases = ["primary-external"]

  tags = local.tags
}

module "kms_replica_external" {
  source = "../.."

  deletion_window_in_days = 7
  description             = "Replica external key example showing various configurations available"
  create_replica_external = true
  is_enabled              = true
  # key material must be the same as the primary's
  key_material_base64      = "Wblj06fduthWggmsT0cLVoIMOkeLbc2kVfMud77i/JY="
  primary_external_key_arn = module.kms_primary_external.key_arn
  valid_to                 = "2023-11-21T23:20:50Z"

  aliases = ["replica-external"]

  # Grants
  grants = {
    lambda = {
      grantee_principal = aws_iam_role.lambda.arn
      operations        = ["Encrypt", "Decrypt", "GenerateDataKey"]
      constraints = {
        encryption_context_equals = {
          Department = "Finance"
        }
      }
    }
  }

  tags = local.tags

  providers = {
    aws = aws.replica
  }
}

################################################################################
# Supporting Resources
################################################################################

resource "aws_iam_role" "lambda" {
  name_prefix = local.name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "sts:AssumeRole"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}
