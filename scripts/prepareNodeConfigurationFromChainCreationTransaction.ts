import { createPublicClient, decodeFunctionData, http } from 'viem';
import {
  createRollupPrepareTransactionReceipt,
  createRollupPrepareTransaction,
  ChainConfig,
} from '@arbitrum/orbit-sdk';
import {
  prepareDasConfig,
  saveDasNodeConfigFile,
  buildNodeConfiguration,
} from '../src/utils/node-configuration';
import {
  getChainConfigFromChainId,
  withFallbackPrivateKey,
  getRpcUrl,
  saveCoreContractsFile,
} from '../src/utils/helpers';
import { chainIsAnytrust } from '../src/utils/chain-info-helpers';
import { createRollupWithDataCostEstimationAbi } from '../src/abis';
import 'dotenv/config';

// Check for required env variables
if (
  !process.env.PARENT_CHAIN_ID ||
  !process.env.CHAIN_OWNER_PRIVATE_KEY ||
  !process.env.BATCH_POSTER_PRIVATE_KEY ||
  !process.env.STAKER_PRIVATE_KEY ||
  !process.env.CHAIN_CREATION_TRANSACTION_HASH
) {
  throw new Error(
    'The following environment variables must be present: PARENT_CHAIN_ID, CHAIN_OWNER_PRIVATE_KEY, BATC_POSTER_PRIVATE_KEY, STAKER_PRIVATE_KEY, CHAIN_CREATION_TRANSACTION_HASH',
  );
}

// Load or generate a random batch poster account
const batchPosterPrivateKey = withFallbackPrivateKey(process.env.BATCH_POSTER_PRIVATE_KEY);

// Load or generate a random staker account
const validatorPrivateKey = withFallbackPrivateKey(process.env.STAKER_PRIVATE_KEY);

// Set the parent chain and create a public client for it
const parentChainInformation = getChainConfigFromChainId(Number(process.env.PARENT_CHAIN_ID));
const parentChainRpc = process.env.PARENT_CHAIN_RPC_URL || getRpcUrl(parentChainInformation);
const parentChainPublicClient = createPublicClient({
  chain: parentChainInformation,
  transport: http(parentChainRpc),
});

const main = async () => {
  console.log('**************************************************************');
  console.log('* Prepare node configuration from chain creation transaction *');
  console.log('**************************************************************');
  console.log('');

  // tx hash for the transaction to create rollup
  const transactionHash = process.env.CHAIN_CREATION_TRANSACTION_HASH as `0x${string}`;

  // get the transaction
  const transaction = createRollupPrepareTransaction(
    await parentChainPublicClient.getTransaction({ hash: transactionHash }),
  );

  const transactionReceipt = createRollupPrepareTransactionReceipt(
    await parentChainPublicClient.getTransactionReceipt({
      hash: transactionHash,
    }),
  );

  // Get the chain configuration
  // const config = transaction.getInputs()[0].config;
  // NOTE: if using a different ABI than the canonical one, decode manually
  // using the following snippet
  const { args } = decodeFunctionData({
    abi: createRollupWithDataCostEstimationAbi,
    data: transaction.input,
  }) as {
    functionName: 'createRollup';
    args: [
      {
        config: {
          chainConfig: string;
          stakeToken: `0x${string}`;
        };
      },
    ];
  };
  if (!args) {
    throw new Error(`Could not decode function data for transaction ${transactionHash}`);
  }
  const config = args[0].config;

  // Extract the chainConfig and the stakeToken
  const chainConfig: ChainConfig = JSON.parse(config.chainConfig);
  const stakeToken: `0x${string}` = config.stakeToken;

  // Get the core contracts from the transaction receipt
  const coreContracts = transactionReceipt.getCoreContracts();

  // Save core contracts in JSON file
  const coreContractsFilePath = saveCoreContractsFile(coreContracts);
  console.log(`Core contracts written to ${coreContractsFilePath}`);

  // Build node configuration
  const { batchPosterfilePath, stakerFilePath, rpcFilePath } = buildNodeConfiguration(
    chainConfig,
    coreContracts,
    batchPosterPrivateKey,
    validatorPrivateKey,
    stakeToken,
    parentChainInformation,
    parentChainRpc,
  );
  console.log(`Batch poster config written to ${batchPosterfilePath}`);
  console.log(`Staker config written to ${stakerFilePath}`);
  console.log(`RPC config written to ${rpcFilePath}`);

  // If we want to use AnyTrust, we need to:
  //    1. set the right keyset in the SequencerInbox
  //    2. generate the DAS node configuration
  if (chainIsAnytrust()) {
    //
    // Prepare DAS node config
    //
    const dasNodeConfig = prepareDasConfig(parentChainRpc, coreContracts.sequencerInbox);
    const dasConfigFilePath = saveDasNodeConfigFile(dasNodeConfig);
    console.log(`DAS node config written to ${dasConfigFilePath}`);
  }
};

// Calling main
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
