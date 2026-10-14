# Desktop app tasks. Run `make` to list them.
NPM ?= npm
.DEFAULT_GOAL := help
.PHONY: help install dev desktop test build bundle check release release-test clean

help: ## List targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install locked frontend dependencies
	$(NPM) ci

dev: ## Run browser preview at http://localhost:1420
	$(NPM) run dev

desktop: ## Run the Tauri desktop app
	$(NPM) run tauri dev

test: ## Run app logic tests and typecheck
	$(NPM) test
	$(NPM) run typecheck

build: ## Build the production frontend
	$(NPM) run build

bundle: ## Build the macOS Apple Silicon app and DMG
	$(NPM) run tauri build -- --target aarch64-apple-darwin

release: export RELEASE_TAG = $(VERSION)
release: ## Create and push a release tag (VERSION=vX.Y.Z)
	node .github/release/tag.mjs "$$RELEASE_TAG"

release-test: ## Test release tagging, R2 publishing and updater manifests
	node --test .github/release/*.test.mjs

check: test release-test ## Run desktop and release checks

clean: ## Remove frontend and native build outputs
	rm -rf dist src-tauri/target
