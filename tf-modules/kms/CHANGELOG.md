# Changelog

All notable changes to this project will be documented in this file.

## [3.1.1](https://github.com/terraform-aws-modules/terraform-aws-kms/compare/v3.1.0...v3.1.1) (2024-10-11)


### Bug Fixes

* Update CI workflow versions to latest ([#35](https://github.com/terraform-aws-modules/terraform-aws-kms/issues/35)) ([c248050](https://github.com/terraform-aws-modules/terraform-aws-kms/commit/c2480502618251c45ab8bcf6c57ec37bd08a8370))

## [3.1.0](https://github.com/terraform-aws-modules/terraform-aws-kms/compare/v3.0.0...v3.1.0) (2024-06-12)


### Features

* Grants output marked as sensitive data ([#33](https://github.com/terraform-aws-modules/terraform-aws-kms/issues/33)) ([965a52d](https://github.com/terraform-aws-modules/terraform-aws-kms/commit/965a52d6686898897bce31d2f409e2ff9e8d5268))

## [3.0.0](https://github.com/terraform-aws-modules/terraform-aws-kms/compare/v2.2.1...v3.0.0) (2024-05-11)


### ⚠ BREAKING CHANGES

* Support `rotation_period_in_days`, AWS Provider v5, Terraform MSV 1.3 (#32)

### Features

* Support `rotation_period_in_days`, AWS Provider v5, Terraform MSV 1.3 ([#32](https://github.com/terraform-aws-modules/terraform-aws-kms/issues/32)) ([f8c96ce](https://github.com/terraform-aws-modules/terraform-aws-kms/commit/f8c96ce4bfc45fa2cb2e2cfa346d0d1930cdfce3))

## [2.2.1](https://github.com/terraform-aws-modules/terraform-aws-kms/compare/v2.2.0...v2.2.1) (2024-03-06)


### Bug Fixes

* Update CI workflow versions to remove deprecated runtime warnings ([#28](https://github.com/terraform-aws-modules/terraform-aws-kms/issues/28)) ([866950f](https://github.com/terraform-aws-modules/terraform-aws-kms/commit/866950f91b3bc4411fa14d1f5c2c304145540d7f))

## [2.2.0](https://github.com/terraform-aws-modules/terraform-aws-kms/compare/v2.1.0...v2.2.0) (2024-02-02)


### Features

* Add wrapper modules ([#26](https://github.com/terraform-aws-modules/terraform-aws-kms/issues/26)) ([e6eba07](https://github.com/terraform-aws-modules/terraform-aws-kms/commit/e6eba07467818a27670db60b3eb46f98dff19ef9))

## [2.1.0](https://github.com/terraform-aws-modules/terraform-aws-kms/compare/v2.0.1...v2.1.0) (2023-11-03)


### Features

* Do not call data resources when `create` is `false` ([#25](https://github.com/terraform-aws-modules/terraform-aws-kms/issues/25)) ([4951c38](https://github.com/terraform-aws-modules/terraform-aws-kms/commit/4951c38f3cd569411eb53476ac8502981083f5d2))

### [2.0.1](https://github.com/terraform-aws-modules/terraform-aws-kms/compare/v2.0.0...v2.0.1) (2023-09-18)


### Bug Fixes

* Default admin permissions for special keys ([#24](https://github.com/terraform-aws-modules/terraform-aws-kms/issues/24)) ([c975efd](https://github.com/terraform-aws-modules/terraform-aws-kms/commit/c975efda5686fd7c9fb98518332617e4876e5317))

## [2.0.0](https://github.com/terraform-aws-modules/terraform-aws-kms/compare/v1.5.0...v2.0.0) (2023-09-05)


### ⚠ BREAKING CHANGES

* Added `custom_key_store_id`, bump version of AWS provider to 4.x (#23)

### Features

* Added `custom_key_store_id`, bump version of AWS provider to 4.x ([#23](https://github.com/terraform-aws-modules/terraform-aws-kms/issues/23)) ([beb5667](https://github.com/terraform-aws-modules/terraform-aws-kms/commit/beb56674a6e5db7dfa6cf70c9e953183d6574472))

## [1.5.0](https://github.com/terraform-aws-modules/terraform-aws-kms/compare/v1.4.0...v1.5.0) (2023-02-09)


### Features

* Add specific policy for Autoscaling service linked roles ([#15](https://github.com/terraform-aws-modules/terraform-aws-kms/issues/15)) ([217ac76](https://github.com/terraform-aws-modules/terraform-aws-kms/commit/217ac76868ac3624bb89e183372d25d2da67bd8b))

## [1.4.0](https://github.com/terraform-aws-modules/terraform-aws-kms/compare/v1.3.1...v1.4.0) (2023-01-28)


### Features

* Support adding KMS replica keys ([#9](https://github.com/terraform-aws-modules/terraform-aws-kms/issues/9)) ([9a7080b](https://github.com/terraform-aws-modules/terraform-aws-kms/commit/9a7080bb00c468a55a85a0584648b51a68807024))

### [1.3.1](https://github.com/terraform-aws-modules/terraform-aws-kms/compare/v1.3.0...v1.3.1) (2023-01-24)


### Bug Fixes

* Use a version for  to avoid GitHub API rate limiting on CI workflows ([#12](https://github.com/terraform-aws-modules/terraform-aws-kms/issues/12)) ([040736e](https://github.com/terraform-aws-modules/terraform-aws-kms/commit/040736eca2e82f27ac1219dcf4f10ee0eb24ff6d))

## [1.3.0](https://github.com/terraform-aws-modules/terraform-aws-kms/compare/v1.2.2...v1.3.0) (2022-11-21)


### Features

* Add support for creating customer managed keys used for Route53 DNSSEC signing ([#10](https://github.com/terraform-aws-modules/terraform-aws-kms/issues/10)) ([d694450](https://github.com/terraform-aws-modules/terraform-aws-kms/commit/d6944500aa33aafa19027facb1828ed3cf837196))

### [1.2.2](https://github.com/terraform-aws-modules/terraform-aws-kms/compare/v1.2.1...v1.2.2) (2022-11-07)


### Bug Fixes

* Update CI configuration files to use latest version ([#8](https://github.com/terraform-aws-modules/terraform-aws-kms/issues/8)) ([01bd36b](https://github.com/terraform-aws-modules/terraform-aws-kms/commit/01bd36b2a07830fe91184c69f3e70c975a1fdd62))

### [1.2.1](https://github.com/terraform-aws-modules/terraform-aws-kms/compare/v1.2.0...v1.2.1) (2022-10-14)


### Bug Fixes

* Modify `key_service_principals` to be generic to support conditions for confused deputy problem ([#7](https://github.com/terraform-aws-modules/terraform-aws-kms/issues/7)) ([7b85239](https://github.com/terraform-aws-modules/terraform-aws-kms/commit/7b85239466b365c31d7e976f82964789d4215c0e))

## [1.2.0](https://github.com/terraform-aws-modules/terraform-aws-kms/compare/v1.1.0...v1.2.0) (2022-10-14)


### Features

* Adding Key Service Principals ([#6](https://github.com/terraform-aws-modules/terraform-aws-kms/issues/6)) ([4841f28](https://github.com/terraform-aws-modules/terraform-aws-kms/commit/4841f28bc1366a789df97f022b42881d5d73421d))

## [1.1.0](https://github.com/terraform-aws-modules/terraform-aws-kms/compare/v1.0.3...v1.1.0) (2022-08-17)


### Features

* Add support for providing aliases using computed attributes ([#4](https://github.com/terraform-aws-modules/terraform-aws-kms/issues/4)) ([8150812](https://github.com/terraform-aws-modules/terraform-aws-kms/commit/81508121e16b9da133259763cca1fe98485a38b7))

### [1.0.3](https://github.com/terraform-aws-modules/terraform-aws-kms/compare/v1.0.2...v1.0.3) (2022-08-15)


### Bug Fixes

* Add support for aliases and grants on `aws_kms_external_key` ([#3](https://github.com/terraform-aws-modules/terraform-aws-kms/issues/3)) ([beea8d6](https://github.com/terraform-aws-modules/terraform-aws-kms/commit/beea8d64e3680978785b1b0a93911c5d602f98fe))

### [1.0.2](https://github.com/terraform-aws-modules/terraform-aws-kms/compare/v1.0.1...v1.0.2) (2022-07-14)


### Bug Fixes

* Correct boolean logic for enabling/disabling key owners policy statement ([#2](https://github.com/terraform-aws-modules/terraform-aws-kms/issues/2)) ([944ea72](https://github.com/terraform-aws-modules/terraform-aws-kms/commit/944ea72ac38f85af0a58f10650285958e78cac0c))

### [1.0.1](https://github.com/terraform-aws-modules/terraform-aws-kms/compare/v1.0.0...v1.0.1) (2022-06-28)


### Bug Fixes

* Reduce required versions for Terraform and AWS provider ([#1](https://github.com/terraform-aws-modules/terraform-aws-kms/issues/1)) ([f80bc66](https://github.com/terraform-aws-modules/terraform-aws-kms/commit/f80bc665e11d7aabacc8be397e782a1dcc1e1148))

## 1.0.0 (2022-06-25)


### Features

* Add support for external key using externally provided material ([2726c25](https://github.com/clowdhaus/terraform-aws-kms/commit/2726c2517fb203b6c3cf3b6e5cec00442336d88e))
* Add support for source and override policy documents ([5a01134](https://github.com/clowdhaus/terraform-aws-kms/commit/5a01134f4358e55cd2b65bfd1a1b6d8c91988dc1))
* Initial implementation of module ([a8a4f33](https://github.com/clowdhaus/terraform-aws-kms/commit/a8a4f33b95320b1d7457cefef3759f3544498f23))
