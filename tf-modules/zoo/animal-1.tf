module "animal-1" {
  source = "../animal"

  #name = "test"
}

module "test" {
  source = "github.com/cloudposse/terraform-null-label.git?ref=0123456789abcdef0123456789abcdef01234567"

  namespace  = "eg"
  stage      = "prod"
  name       = "bastion"
  attributes = ["public"]
  delimiter  = "-"
}
