import { createPublicClient, getAddress, http, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  getChainConfigFromChainId,
  getRpcUrl,
  readChainConfigFile,
  readCoreContractsFile,
  readTokenBridgeContractsFile,
  sanitizePrivateKey,
} from '../../src/utils/helpers';
import { getChainInformation } from '../../src/utils/chain-info-helpers';
import 'dotenv/config';
import { upgradeExecutorABI } from '@arbitrum/chain-sdk/contracts/UpgradeExecutor.js';
import {
  arbOwnerPublicABI,
  arbOwnerPublicAddress,
} from '@arbitrum/chain-sdk/contracts/ArbOwnerPublic.js';

// Check for required env variables
// Check for required env variables
if (
  !process.env.DEPLOYER_PRIVATE_KEY ||
  !process.env.CHAIN_OWNER_ADDRESS ||
  !process.env.PARENT_CHAIN_ID
) {
  throw new Error(
    'The following environment variables must be present: DEPLOYER_PRIVATE_KEY, CHAIN_OWNER_ADDRESS, PARENT_CHAIN_ID',
  );
}

// Executor role hash
const UPGRADE_EXECUTOR_ROLE_EXECUTOR = keccak256(toHex('EXECUTOR_ROLE'));

// Load accounts
const deployer = privateKeyToAccount(sanitizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY));
const chainOwnerAddress = getAddress(process.env.CHAIN_OWNER_ADDRESS);

// Set the parent chain and create a public client for it
const parentChainInformation = getChainConfigFromChainId(Number(process.env.PARENT_CHAIN_ID));
const parentChainPublicClient = createPublicClient({
  chain: parentChainInformation,
  transport: http(process.env.PARENT_CHAIN_RPC_URL || getRpcUrl(parentChainInformation)),
});

// Set the Arbitrum chain client
const chainInformation = getChainInformation();
const arbitrumChainPublicClient = createPublicClient({
  chain: chainInformation,
  transport: http(),
});

const main = async () => {
  console.log('*********************************');
  console.log('* Chain deployment verification *');
  console.log('*********************************');
  console.log('');

  const chainConfig = readChainConfigFile();
  if (!chainConfig) {
    throw new Error(
      'Chain configuration not found. Please run the deploy script first to generate the chain configuration file.',
    );
  }

  const coreContracts = readCoreContractsFile();
  if (!coreContracts) {
    throw new Error(
      'Core contracts information not found. Please run the deploy script first to generate the core contracts file.',
    );
  }

  const tokenBridgeContracts = readTokenBridgeContractsFile();
  if (!tokenBridgeContracts) {
    throw new Error(
      'Token bridge contracts information not found. Please run the deploy script first to generate the token bridge contracts file.',
    );
  }

  //
  // Verify TokenBridge contracts creation
  //
  // Note: if the router contract is present, the factory and all other contracts should also be present
  const arbitrumChainRouterBytecode = await arbitrumChainPublicClient.getBytecode({
    address: tokenBridgeContracts.orbitChainContracts.router,
  });

  if (!arbitrumChainRouterBytecode || arbitrumChainRouterBytecode == '0x') {
    throw new Error(
      `Can't find TokenBridge Router contract in the Arbitrum chain. Retryable ticket execution might have failed.`,
    );
  }
  console.log('TokenBridge contracts verified successfully');

  //
  // Verify chain ownership
  //

  // 1. Check whether the chain owner has the EXECUTOR role in the UpgradeExecutor contract on the parent-chain
  const parentChainUpgradeExecutorHasRole = await parentChainPublicClient.readContract({
    address: coreContracts.upgradeExecutor,
    abi: upgradeExecutorABI,
    functionName: 'hasRole',
    args: [UPGRADE_EXECUTOR_ROLE_EXECUTOR, chainOwnerAddress],
  });

  if (!parentChainUpgradeExecutorHasRole) {
    throw new Error(
      `Chain owner ${chainOwnerAddress} does not have EXECUTOR role in the UpgradeExecutor contract on the parent-chain.`,
    );
  }
  console.log(
    `Chain owner ${chainOwnerAddress} has EXECUTOR role in the UpgradeExecutor contract on the parent-chain.`,
  );

  // 2. Check whether the deployer has been removed from the UpgradeExecutor contract's executors list on the parent-chain
  const parentChainUpgradeExecutorDeployerHasRole = await parentChainPublicClient.readContract({
    address: coreContracts.upgradeExecutor,
    abi: upgradeExecutorABI,
    functionName: 'hasRole',
    args: [UPGRADE_EXECUTOR_ROLE_EXECUTOR, deployer.address],
  });

  if (parentChainUpgradeExecutorDeployerHasRole) {
    throw new Error(
      `Deployer ${deployer.address} still has EXECUTOR role in the UpgradeExecutor contract on the parent-chain.`,
    );
  }
  console.log(
    `Deployer ${deployer.address} does not have EXECUTOR role in the UpgradeExecutor contract on the parent-chain.`,
  );

  // 3. Check whether the chain owner has the EXECUTOR role in the UpgradeExecutor contract on the child-chain
  const childChainUpgradeExecutorHasRole = await arbitrumChainPublicClient.readContract({
    address: tokenBridgeContracts.orbitChainContracts.upgradeExecutor,
    abi: upgradeExecutorABI,
    functionName: 'hasRole',
    args: [UPGRADE_EXECUTOR_ROLE_EXECUTOR, chainOwnerAddress],
  });

  if (!childChainUpgradeExecutorHasRole) {
    console.log(childChainUpgradeExecutorHasRole);
    throw new Error(
      `Chain owner ${chainOwnerAddress} does not have EXECUTOR role in the UpgradeExecutor contract on the child-chain. Retryable ticket execution might have failed.`,
    );
  }
  console.log(
    `Chain owner ${chainOwnerAddress} has EXECUTOR role in the UpgradeExecutor contract on the child-chain.`,
  );

  // 4. Check whether the deployer has been removed from the UpgradeExecutor contract's executors list on the child-chain
  const childChainUpgradeExecutorDeployerHasRole = await arbitrumChainPublicClient.readContract({
    address: tokenBridgeContracts.orbitChainContracts.upgradeExecutor,
    abi: upgradeExecutorABI,
    functionName: 'hasRole',
    args: [UPGRADE_EXECUTOR_ROLE_EXECUTOR, deployer.address],
  });

  if (childChainUpgradeExecutorDeployerHasRole) {
    throw new Error(
      `Deployer ${deployer.address} still has EXECUTOR role in the UpgradeExecutor contract on the child-chain. Retryable ticket execution might have failed.`,
    );
  }
  console.log(
    `Deployer ${deployer.address} does not have EXECUTOR role in the UpgradeExecutor contract on the child-chain.`,
  );

  // 5. Check whether the UpgradeExecutor contract on the child-chain is set as a chain owner
  const childChainUpgradeExecutorIsChainOwner = await arbitrumChainPublicClient.readContract({
    address: arbOwnerPublicAddress,
    abi: arbOwnerPublicABI,
    functionName: 'isChainOwner',
    args: [tokenBridgeContracts.orbitChainContracts.upgradeExecutor],
  });

  if (!childChainUpgradeExecutorIsChainOwner) {
    throw new Error(
      `UpgradeExecutor contract ${tokenBridgeContracts.orbitChainContracts.upgradeExecutor} is not set as a chain owner on the child-chain. Retryable ticket execution might have failed.`,
    );
  }
  console.log(
    `UpgradeExecutor contract ${tokenBridgeContracts.orbitChainContracts.upgradeExecutor} is set as a chain owner on the child-chain.`,
  );

  // 6. Check whether the deployer has been removed from the chain owner list on the child-chain
  const deployerIsChainOwner = await arbitrumChainPublicClient.readContract({
    address: arbOwnerPublicAddress,
    abi: arbOwnerPublicABI,
    functionName: 'isChainOwner',
    args: [deployer.address],
  });

  if (deployerIsChainOwner) {
    throw new Error(
      `Deployer ${deployer.address} is still a chain owner on the child-chain. Retryable ticket execution might have failed.`,
    );
  }
  console.log(
    `Deployer ${deployer.address} is not a chain owner on the child-chain. Chain ownership transfer successful.`,
  );

  // If we reached this point, all verifications have passed
  console.log('');
  console.log('All verifications passed successfully. Chain deployment is correct.');
};

// Calling main
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
