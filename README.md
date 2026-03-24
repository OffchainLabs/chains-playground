# Arbitrum chains playground

This repository contains everything that's needed to start playing with Arbitrum chains: deployment of contracts, customizing and building your nitro node and starting up your chain.

## Setup

1. Clone the repository

    `git clone https://github.com/OffchainLabs/chains-playground.git`

2. Install dependencies

    `pnpm install`

    `git submodule update --init --recursive --force`

## Configure your chain

Make a copy of the `.env.example` file and call it `.env`. Then, make sure you set a private key for the deployer, and the addresses of the final chain owner, batch poster and staker accounts. You can leave the rest of options with their default, or customize any of them.

## Deploy an Arbitrum chain

Chain deployment can be performed only with a parent chain RPC. The script will perform the following operations:

1. Deploy the core contracts
2. Deploy the TokenBridge
3. Transfer ownership to the specified chain owner address
4. Show all contracts deployed and chain configuration

Run the following script

```shell
pnpm full-deployment
```

This script will deploy the parent chain contracts using the specified RPC, and then retryable tickets to send the ownership transferring transactions.

Once a node is running for the new chain, all retryable tickets execution can be checked with the following script

```shell
pnpm verify-deployment
```

## Individual scripts

The `full-deployment` scripts make use of multiple scripts that perform individual actions

1. Deploy core contracts: `pnpm deploy-chain`
2. Deploy TokenBridge: `pnpm deploy-token-bridge`
3. Transfer ownership: `pnpm transfer-ownership`

These can be run individually

## Start your node

Once the chain contracts are all deployed, you can run a node for your chain.

Note that you'll need to set the `BATCH_POSTER_PRIVATE_KEY` and `STAKER_PRIVATE_KEY` env variables if you're running the batch poster and staker.

First build the node configuration with the following command:

```shell
pnpm build-node-configuration
```

Then run your node with:

```shell
pnpm start-node
```

### Structure of docker containers

When starting your nodes with `pnpm start-node` the following containers will start, depending on the mode used:

- If the `$SPLIT_NODES` env variable is set to false, a single `nitro` container will start that runs a nitro node acting as the batch-poster, staker and regular rpc.
- If the `$SPLIT_NODES` env variable is set to true, the following containers will start:
    - `batch-poster`: the sequencer/batch-poster for your chain
    - `staker`: the validator/staker for your chain
    - `rpc`: a regular RPC node for your chain

- Additionally, a `das-server` container will start if you're running an AnyTrust chain. This container will run a Data Availability Server. 

You can manage each individual container with the following commands:

- `docker compose stop <container>`: stops the specified container
- `docker compose start <container>`: starts the specified container
- `docker compose restart <container>`: restarts the specified container
- `docker compose create <container>`: creates the specified container (in case it's been removed)

### Enable Blockscout

Setting the env variable `ENABLE_BLOCKSCOUT` to true, will start the blockscout containers when running `start-node`.

Blockscout will be available at http://localhost/

## Other available scripts

The following scripts are also available

### Fund relevant accounts

This will fund the batch poster and staker accounts with `FUNDING_AMOUNT`. It will also deposit the same amount to the deployer address on the Arbitrum chain.

```shell
pnpm initialize-chain
```

## Clean up data

To clean up all data generated while running the chain, you can run the following command

```shell
pnpm clean
```

## Using a custom parent chain

If the parent chain is not supported in the Arbitrum Chain SDK, you can still deploy the RollupCreator and the TokenBridgeCreator and create a chain using those.

### Deploy the RollupCreator factory

Make sure the submodules are up to date

```shell
git submodule update --init --force --recursive
```

Build the nitro-contracts submodule

```shell
pnpm build-nitro-contracts
```

Modify the following env variable:

```shell
# MAX_DATA_SIZE should be 104857 for L3s and 117964 for L2s
MAX_DATA_SIZE=
```

Run the rollup creator deployer script with:

```shell
pnpm deploy-rollup-creator
```

### Deploy the TokenBridgeCreator factory

Make sure the submodules are up to date

```shell
git submodule update --init --force --recursive
```

Build the token-bridge-contracts submodule

```shell
pnpm build-token-bridge-contracts
```

Modify the following env variable:

```shell
# BASECHAIN_WETH should be set to the WETH address of the parent chain
BASECHAIN_WETH=
```

Run the rollup creator deployer script with:

```shell
pnpm deploy-token-bridge-creator
```

### Create a chain using the new factory contracts

Set the following env variables:

```shell
ROLLUPCREATOR_FACTORY_ADDRESS=
WETH_ADDRESS=
# CHAIN_MAX_DATA_SIZE should be 104857 for L3s and 117964 for L2s
CHAIN_MAX_DATA_SIZE=
```

And run the same process as described in [Deploy an Arbitrum chain](#deploy-an-arbitrum-chain).
