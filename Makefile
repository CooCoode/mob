# Common tasks for mob. Run `make` (or `make help`) to list them.

GO      ?= go
BIN     ?= bin/mobd
ARGS    ?=
APP_DIR := apps/mob
NPM     := npm --prefix $(APP_DIR)

.DEFAULT_GOAL := help
.PHONY: help build test race vet fmt check clean \
	init serve start stop restart status logs \
	app-install app-dev app-desktop app-test app-build app-bundle

help: ## List targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

## --- mobd (office Mac) ---

build: ## Build mobd into bin/mobd
	$(GO) build -o $(BIN) ./cmd/mobd

test: ## Run Go tests
	$(GO) test ./...

race: ## Run Go tests with the race detector
	$(GO) test -race ./...

vet: ## go vet
	$(GO) vet ./...

fmt: ## gofmt all Go files
	gofmt -w cmd internal

init: build ## Create the user config (never overwrite)
	$(BIN) init $(ARGS)

serve: build ## Run mobd in the foreground
	$(BIN) serve $(ARGS)

start: build ## Start mobd via the user LaunchAgent
	$(BIN) start $(ARGS)

stop: build ## Stop mobd and disable login startup
	$(BIN) stop

restart: build ## Reload config and restart mobd
	$(BIN) restart $(ARGS)

status: build ## Show mobd status and address
	$(BIN) status

logs: build ## Follow the mobd log
	$(BIN) logs

## --- apps/mob (home App) ---

app-install: ## Install App dependencies
	$(NPM) install

app-dev: ## App in the browser (http://localhost:1420)
	$(NPM) run dev

app-desktop: ## App as the Tauri desktop window
	$(NPM) run tauri dev

app-test: ## App logic tests and typecheck
	$(NPM) test
	$(NPM) run typecheck

app-build: ## Production web build of the App
	$(NPM) run build

app-bundle: ## Packaged desktop App (.app / .dmg)
	$(NPM) run tauri build

## --- everything ---

check: vet test app-test ## Everything CI would run: Go vet + tests, App tests + typecheck

clean: ## Remove build outputs
	rm -rf bin $(APP_DIR)/dist
