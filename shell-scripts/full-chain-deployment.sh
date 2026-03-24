#!/usr/bin/env bash
set -e

# Load variables from .env file (allowing overrides from CLI)
currentEnvs=$(declare -p -x)
set -o allexport
source .env
set +o allexport
eval "$currentEnvs"

# Deploy chain and token bridge
pnpm deploy-chain
pnpm deploy-token-bridge

# Transfer ownership of the chain to the specified chain owner address
pnpm transfer-ownership

# Show contracts and chain config
pnpm get-chain-deployment-info