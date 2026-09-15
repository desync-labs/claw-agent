# The weavr agent images, built the way the other weavr services are
# (Indexer/weavr/mapper/Makefile): Docker Hub, <sha>-dev + dev off a branch,
# <tag> + <sha> + latest when HEAD sits on a tag.
#
#   make -C weavr image            # the fork itself: intothefathom/claw-agent
#   make -C weavr curator          # fork + curator profile + plugin from the ops repo
#   make -C weavr all              # both, in order
#
# The curator build clones composable-portfolios-ops with --mount=type=secret;
# the token defaults to the gh CLI session (override: OPS_REF=... GH_TOKEN=...).
.PHONY: image-build image-push image curator-build curator-push curator all

BASE_IMAGE    := intothefathom/claw-agent
CURATOR_IMAGE := intothefathom/weavr-curator-agent
OPS_REPO ?= desync-labs/composable-portfolios-ops
OPS_REF  ?= dev
PLATFORM ?= linux/amd64

MAKEFILE_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
REPO_ROOT    := $(abspath $(MAKEFILE_DIR)/..)

SHORT_SHA := $(shell git -C $(REPO_ROOT) rev-parse --short HEAD)
FULL_SHA  := $(shell git -C $(REPO_ROOT) rev-parse HEAD)
EXACT_TAG := $(shell git -C $(REPO_ROOT) describe --tags --exact-match 2>/dev/null)

ifeq ($(EXACT_TAG),)
TAGS := $(SHORT_SHA)-dev dev
else
TAGS := $(EXACT_TAG) $(SHORT_SHA) latest
endif
PIN := $(firstword $(TAGS))

GH_TOKEN ?= $(shell gh auth token 2>/dev/null)

image-build:
	@echo "Building $(BASE_IMAGE) (tags: $(TAGS))..."
	@docker buildx build \
		--platform $(PLATFORM) \
		--build-arg HERMES_GIT_SHA=$(FULL_SHA) \
		--file $(REPO_ROOT)/Dockerfile \
		$(foreach t,$(TAGS),--tag $(BASE_IMAGE):$(t)) \
		--load \
		$(REPO_ROOT)

image-push:
	@for t in $(TAGS); do echo "Pushing $(BASE_IMAGE):$$t"; docker push $(BASE_IMAGE):$$t; done

image: image-build image-push

curator-build:
	@echo "Building $(CURATOR_IMAGE) from $(BASE_IMAGE):$(PIN) + $(OPS_REPO)@$(OPS_REF) (tags: $(TAGS))..."
	@GH_TOKEN="$(GH_TOKEN)" docker buildx build \
		--platform $(PLATFORM) \
		--secret id=gh_token,env=GH_TOKEN \
		--build-arg BASE_IMAGE=$(BASE_IMAGE):$(PIN) \
		--build-arg OPS_REPO=$(OPS_REPO) \
		--build-arg OPS_REF=$(OPS_REF) \
		--file $(MAKEFILE_DIR)/curator/Dockerfile \
		$(foreach t,$(TAGS),--tag $(CURATOR_IMAGE):$(t)) \
		--load \
		$(MAKEFILE_DIR)/curator

curator-push:
	@for t in $(TAGS); do echo "Pushing $(CURATOR_IMAGE):$$t"; docker push $(CURATOR_IMAGE):$$t; done

curator: curator-build curator-push

all: image curator
