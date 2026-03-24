# Arbitrum chains playground

This repository contains everything that's needed to start playing with Arbitrum chains: deployment of contracts, customizing and building your nitro node and starting up your chain.

## Setup

1. Clone the repository

    `git clone https://github.com/TucksonDev/orbit-playground.git`

2. Install dependencies

    `yarn install`

    `git submodule update --init --recursive --force`

## Configure your chain

Make a copy of the `.env.example` file and call it `.env`. Then, make sure you set a private key for the Chain owner, Batch poster and Staker accounts. You can leave the rest of options with their default, or customize any of them.

## Deploy an Arbitrum chain

1. Deploy the contracts

    `yarn deploy-chain`

2. Launch your nitro node

    `yarn start-node`

3. Initialize your chain

    `yarn initialize-chain`

4. (Optional) Deploy the Token Bridge

    `yarn deploy-token-bridge`

5. (Optional) Transfer ownership of the chain to the UpgradeExecutor

    `yarn transfer-ownership`

## Structure of docker containers

When starting your nodes with `yarn start-node` the following containers will start, depending on the mode used:

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

## Enable Blockscout

Setting the env variable `ENABLE_BLOCKSCOUT` to true, will start the blockscout containers when running `start-node`.

Blockscout will be available at http://localhost/

## Clean up data

To clean up all data generated while running the chain, you can run the following command

`yarn clean`

## Using a custom parent chain

If the parent chain is not supported in the Arbitrum Chain SDK, you can still deploy the RollupCreator and the TokenBridgeCreator and create a chain using those.

### Deploy the RollupCreator factory

Make sure the submodules are up to date

```shell
git submodule update --init --force --recursive
```

Build the nitro-contracts submodule

```shell
yarn build-nitro-contracts
```

Modify the following env variable:

```shell
# MAX_DATA_SIZE should be 104857 for L3s and 117964 for L2s
MAX_DATA_SIZE=
```

Run the rollup creator deployer script with:

```shell
yarn deploy-rollup-creator
```

### Deploy the TokenBridgeCreator factory

Make sure the submodules are up to date

```shell
git submodule update --init --force --recursive
```

Build the token-bridge-contracts submodule

```shell
yarn build-token-bridge-contracts
```

Modify the following env variable:

```shell
# BASECHAIN_WETH should be set to the WETH address of the parent chain
BASECHAIN_WETH=
```

Run the rollup creator deployer script with:

```shell
yarn deploy-token-bridge-creator
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
