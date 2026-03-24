import {
  buildNodeConfiguration,
  saveNodeConfigFile,
  splitConfigPerType,
} from '../../src/utils/node-configuration';
import {
  getChainConfigFromChainId,
  sanitizePrivateKey,
  getRpcUrl,
  readCoreContractsFile,
  readChainConfigFile,
} from '../../src/utils/helpers';
import 'dotenv/config';
import { createPublicClient, http } from 'viem';
import { getChainStakeToken } from '../../src/utils/chain-info-helpers';

// Check for required env variables
if (
  !process.env.PARENT_CHAIN_ID ||
  !process.env.BATCH_POSTER_PRIVATE_KEY ||
  !process.env.STAKER_PRIVATE_KEY
) {
  throw new Error(
    'The following environment variables must be present: PARENT_CHAIN_ID, BATCH_POSTER_PRIVATE_KEY, STAKER_PRIVATE_KEY',
  );
}

// Privileged accounts
const batchPosterPrivateKey = sanitizePrivateKey(process.env.BATCH_POSTER_PRIVATE_KEY);
const validatorPrivateKey = sanitizePrivateKey(process.env.STAKER_PRIVATE_KEY);

// Set the parent chain and create a public client for it
const parentChainInformation = getChainConfigFromChainId(Number(process.env.PARENT_CHAIN_ID));
const parentChainRpc = process.env.PARENT_CHAIN_RPC_URL || getRpcUrl(parentChainInformation);
const parentChainPublicClient = createPublicClient({
  chain: parentChainInformation,
  transport: http(parentChainRpc),
});

const main = async () => {
  console.log('******************************');
  console.log('* Node configuration builder *');
  console.log('******************************');
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

  // Get stake token
  const stakeToken = await getChainStakeToken(parentChainPublicClient);

  // Build node configuration
  const baseNodeConfig = buildNodeConfiguration(
    chainConfig,
    coreContracts,
    batchPosterPrivateKey,
    validatorPrivateKey,
    stakeToken,
    parentChainInformation,
    parentChainRpc,
  );

  if (process.env.SPLIT_NODES !== 'true') {
    // Save single node config file
    const singleNodeConfigFilePath = saveNodeConfigFile('rpc', baseNodeConfig);
    console.log(`Node config written to ${singleNodeConfigFilePath}`);
    return;
  } else {
    // Split config into the different entities
    const { batchPosterConfig, stakerConfig, rpcConfig } = splitConfigPerType(baseNodeConfig);
    const batchPosterfilePath = saveNodeConfigFile('batch-poster', batchPosterConfig);
    const stakerFilePath = saveNodeConfigFile('staker', stakerConfig);
    const rpcFilePath = saveNodeConfigFile('rpc', rpcConfig);
    console.log(`Batch poster config written to ${batchPosterfilePath}`);
    console.log(`Staker config written to ${stakerFilePath}`);
    console.log(`RPC config written to ${rpcFilePath}`);
  }
};

// Calling main
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
