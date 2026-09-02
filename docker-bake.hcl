variable "PLATFORM" {
  default = "linux/amd64"
}

variable "BASE_IMAGE" {
  default = "docker.io/beclab/lares-base:10"
}

variable "IMAGE" {
  default = "docker.io/beclab/lares:dev"
}

target "base" {
  context    = "."
  dockerfile = "Dockerfile.base"
  platforms  = [PLATFORM]
  tags       = [BASE_IMAGE]
}

target "app" {
  context    = "."
  dockerfile = "Dockerfile"
  contexts = {
    lares_base = "target:base"
  }
  args = {
    BASE_IMAGE = "lares_base"
  }
  platforms = [PLATFORM]
  tags      = [IMAGE]
}
