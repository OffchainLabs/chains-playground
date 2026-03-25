import { createPublicClient, getAddress, http, parseEther, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createRollupPrepareDeploymentParamsConfig,
  prepareChainConfig,
  createRollup,
  setValidKeysetPrepareTransactionRequest,
} from '@arbitrum/chain-sdk';
import { generateChainId } from '@arbitrum/chain-sdk/utils';
import {
  getBlockExplorerUrl,
  getChainConfigFromChainId,
  sanitizePrivateKey,
  getRpcUrl,
  saveCoreContractsFile,
  isParentChainSupported,
  saveChainConfigFile,
} from '../../src/utils/helpers';
import { chainIsAnytrust } from '../../src/utils/chain-info-helpers';
import 'dotenv/config';

// Check for required env variables
if (
  !process.env.PARENT_CHAIN_ID ||
  !process.env.DEPLOYER_PRIVATE_KEY ||
  !process.env.BATCH_POSTER_ADDRESS ||
  !process.env.STAKER_ADDRESS
) {
  throw new Error(
    'The following environment variables must be present: PARENT_CHAIN_ID, DEPLOYER_PRIVATE_KEY, BATCH_POSTER_ADDRESS, STAKER_ADDRESS',
  );
}

// Privileged accounts
const batchPosterAddress = getAddress(process.env.BATCH_POSTER_ADDRESS);
const validatorAddress = getAddress(process.env.STAKER_ADDRESS);

// Set the parent chain and create a public client for it
const parentChainInformation = getChainConfigFromChainId(Number(process.env.PARENT_CHAIN_ID));
const parentChainIsSupported = isParentChainSupported(parentChainInformation.id);
const parentChainRpc = process.env.PARENT_CHAIN_RPC_URL || getRpcUrl(parentChainInformation);
const parentChainPublicClient = createPublicClient({
  chain: parentChainInformation,
  transport: http(parentChainRpc),
});

// Load the deployer account
const deployer = privateKeyToAccount(sanitizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY));

const main = async () => {
  console.log('**************************');
  console.log('* Arbitrum chain creator *');
  console.log('**************************');
  console.log('');

  // Generate a random chain id
  const chainId = process.env.ARBITRUM_CHAIN_ID
    ? Number(process.env.ARBITRUM_CHAIN_ID)
    : generateChainId();

  //
  // Create the chain config
  // Note: the initial chain owner will be the deployer, to facilitate the initial admin actions. It will later change to the address specified in CHAIN_OWNER_ADDRESS
  //
  const chainConfig = prepareChainConfig({
    chainId: chainId,
    arbitrum: {
      InitialChainOwner: deployer.address,
      DataAvailabilityCommittee: process.env.USE_ANYTRUST == 'true' ? true : false,
    },
  });

  // Prepare the transaction for deploying the core contracts
  const arbitrumChainConfig = createRollupPrepareDeploymentParamsConfig(parentChainPublicClient, {
    chainConfig,
    chainId: BigInt(chainId),
    owner: deployer.address,

    // Extra parametrization
    confirmPeriodBlocks: 20n, // Reduce confirm period blocks
    baseStake: parseEther('0.1'), // Reduce base stake for proving

    // The following parameters are mandatory for non-supported parent chains
    challengeGracePeriodBlocks: parentChainIsSupported ? undefined : 20n,
    minimumAssertionPeriod: parentChainIsSupported ? undefined : 75n,
    validatorAfkBlocks: parentChainIsSupported ? undefined : 201600n,
    sequencerInboxMaxTimeVariation: parentChainIsSupported
      ? undefined
      : {
          delayBlocks: 28800n,
          delaySeconds: 345600n,
          futureBlocks: 300n,
          futureSeconds: 3600n,
        },
  });

  console.log(`Chain configuration is:`);
  console.log(arbitrumChainConfig);

  // Native token check
  const nativeToken =
    (process.env.NATIVE_TOKEN_ADDRESS && getAddress(process.env.NATIVE_TOKEN_ADDRESS)) ||
    zeroAddress;

  //
  // Rollup contracts deployment
  //
  const transactionResult = await createRollup({
    params: {
      config: arbitrumChainConfig,
      batchPosters: [batchPosterAddress],
      validators: [validatorAddress],
      nativeToken,
      deployFactoriesToL2: process.env.DEPLOY_FACTORIES_TO_L2 == 'true' ? true : false,

      // The following parameters are mandatory for non-supported parent chains
      maxDataSize: parentChainIsSupported ? undefined : BigInt(process.env.CHAIN_MAX_DATA_SIZE!),
    },
    account: deployer,
    parentChainPublicClient,
  });

  console.log(
    `Arbitrum chain was successfully deployed. Transaction hash: ${getBlockExplorerUrl(
      parentChainInformation,
    )}/tx/${transactionResult.transactionReceipt.transactionHash}`,
  );

  // Store the chain configuration in a JSON file
  const chainConfigFilePath = saveChainConfigFile(chainConfig);
  console.log(`Chain configuration written to ${chainConfigFilePath}`);

  // Get the core contracts from the transaction receipt
  const coreContracts = transactionResult.transactionReceipt.getCoreContracts();

  // Save core contracts in JSON file
  const coreContractsFilePath = saveCoreContractsFile(coreContracts);
  console.log(`Core contracts written to ${coreContractsFilePath}`);

  // If we want to use AnyTrust, we need to set the right keyset in the SequencerInbox
  if (chainIsAnytrust()) {
    //
    // Set the default keyset in the SequencerInbox
    //

    // Default keyset
    const keyset =
      '0x00000000000000010000000000000001012160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

    // Prepare the transaction setting the keyset
    const txRequest = await setValidKeysetPrepareTransactionRequest({
      coreContracts: {
        upgradeExecutor: coreContracts.upgradeExecutor,
        sequencerInbox: coreContracts.sequencerInbox,
      },
      keyset,
      account: deployer.address,
      publicClient: parentChainPublicClient,
    });

    // Sign and send the transaction
    const txHash = await parentChainPublicClient.sendRawTransaction({
      serializedTransaction: await deployer.signTransaction(txRequest),
    });

    // Wait for the transaction receipt
    const txReceipt = await parentChainPublicClient.waitForTransactionReceipt({ hash: txHash });

    console.log(
      `Keyset updated in ${getBlockExplorerUrl(parentChainInformation)}/tx/${
        txReceipt.transactionHash
      }`,
    );
  }
};

// Calling main
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
