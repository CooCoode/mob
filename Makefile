# Common tasks for mob. Run `make` (or `make help`) to list them.

GO      ?= go
BIN     ?= bin/mobd
APP_DIR := apps/mob
NPM     := npm --prefix $(APP_DIR)

.DEFAULT_GOAL := help
.PHONY: help build test race vet fmt check clean \
	start stop restart status logs \
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

start: ## Start mobd in the background (rebuilds when sources changed)
	./scripts/mobd.sh start

stop: ## Stop mobd
	./scripts/mobd.sh stop

restart: ## Restart mobd (rebuilds when sources changed)
	./scripts/mobd.sh restart

status: ## Show mobd status
	./scripts/mobd.sh status

logs: ## Follow the mobd log
	tail -f scripts/run/mobd.log

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
