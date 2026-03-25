import { createPublicClient, http, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  applyBuffer,
  getBlockExplorerUrl,
  getChainConfigFromChainId,
  getRpcUrl,
  readChainConfigFile,
  readCoreContractsFile,
  sanitizePrivateKey,
  saveTokenBridgeContractsFile,
} from '../../src/utils/helpers';
import { getChainNativeToken } from '../../src/utils/chain-info-helpers';
import 'dotenv/config';
import {
  createTokenBridgeEnoughCustomFeeTokenAllowance,
  createTokenBridgePrepareCustomFeeTokenApprovalTransactionRequest,
  createTokenBridgePrepareSetWethGatewayTransactionReceipt,
  createTokenBridgePrepareTransactionReceipt,
  enqueueTokenBridgePrepareSetWethGatewayTransactionRequest,
  enqueueTokenBridgePrepareTransactionRequest,
} from '@arbitrum/chain-sdk';
import { calculateMaxSubmissionCost } from '../../src/utils/on-chain-helpers';

// Check for required env variables
if (
  !process.env.DEPLOYER_PRIVATE_KEY ||
  !process.env.PARENT_CHAIN_ID ||
  !process.env.MAX_GAS_PRICE
) {
  throw new Error(
    'The following environment variables must be present: DEPLOYER_PRIVATE_KEY, PARENT_CHAIN_ID, MAX_GAS_PRICE',
  );
}

// Gas configuration for retryable tickets
const maxGasForContracts = 15_000_000n;
const maxGasForFactory = 5_000_000n;
const maxGasForWethGateway = 60_000n;
const dataLengthForFactory = 25_000n; // estimation obtained from previous transactions (23562), should be updated if the factory contract code changes
const dataLengthForContracts = 40_000n; //  estimation obtained from previous transactions (37476), should be updated if the factory contract code changes
const dataLengthForWethGateway = 300n; // estimation obtained from previous transactions (292), should be updated if the setWethGateway function code changes
const defaultMaxGasPrice = BigInt(process.env.MAX_GAS_PRICE);

// Load accounts
const deployer = privateKeyToAccount(sanitizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY));

// Set the parent chain and create a public client for it
const parentChainInformation = getChainConfigFromChainId(Number(process.env.PARENT_CHAIN_ID));
const parentChainPublicClient = createPublicClient({
  chain: parentChainInformation,
  transport: http(process.env.PARENT_CHAIN_RPC_URL || getRpcUrl(parentChainInformation)),
});

// Get chain config and core contracts
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

const main = async () => {
  console.log('*************************');
  console.log('* Token bridge deployer *');
  console.log('*************************');
  console.log('');

  // Check for native token
  const nativeToken = getChainNativeToken();

  if (nativeToken != zeroAddress) {
    // prepare transaction to approve custom fee token spend
    const allowanceParams = {
      nativeToken: nativeToken,
      owner: deployer.address,
      publicClient: parentChainPublicClient,
    };
    if (!(await createTokenBridgeEnoughCustomFeeTokenAllowance(allowanceParams))) {
      const approvalTxRequest =
        await createTokenBridgePrepareCustomFeeTokenApprovalTransactionRequest(allowanceParams);

      // sign and send the transaction
      const approvalTxHash = await parentChainPublicClient.sendRawTransaction({
        serializedTransaction: await deployer.signTransaction(approvalTxRequest),
      });

      // get the transaction receipt after waiting for the transaction to complete
      const approvalTxReceipt = await parentChainPublicClient.waitForTransactionReceipt({
        hash: approvalTxHash,
      });

      console.log(
        `Tokens approved in ${getBlockExplorerUrl(parentChainInformation)}/tx/${
          approvalTxReceipt.transactionHash
        }`,
      );
    }
  }

  const maxSubmissionCostForFactory = await calculateMaxSubmissionCost(
    parentChainPublicClient,
    dataLengthForFactory,
  );
  const maxSubmissionCostForContracts = await calculateMaxSubmissionCost(
    parentChainPublicClient,
    dataLengthForContracts,
  );

  const txRequest = await enqueueTokenBridgePrepareTransactionRequest({
    params: {
      rollup: coreContracts.rollup,
      rollupOwner: deployer.address,
    },
    account: deployer.address,
    parentChainPublicClient,
    maxGasForContracts: applyBuffer(maxGasForContracts),
    maxGasForFactory: applyBuffer(maxGasForFactory),
    maxGasPrice: defaultMaxGasPrice,
    maxSubmissionCostForFactory: applyBuffer(maxSubmissionCostForFactory),
    maxSubmissionCostForContracts: applyBuffer(maxSubmissionCostForContracts),
  });

  // sign and send the transaction
  console.log(`Deploying the TokenBridge...`);
  const txHash = await parentChainPublicClient.sendRawTransaction({
    serializedTransaction: await deployer.signTransaction(txRequest),
  });

  // get the transaction receipt after waiting for the transaction to complete
  const txReceipt = createTokenBridgePrepareTransactionReceipt(
    await parentChainPublicClient.waitForTransactionReceipt({ hash: txHash }),
  );
  console.log(
    `Deployed in ${getBlockExplorerUrl(parentChainInformation)}/tx/${txReceipt.transactionHash}`,
  );

  // fetching the TokenBridge contracts
  const tokenBridgeContracts = await txReceipt.getTokenBridgeContracts({
    parentChainPublicClient,
  });
  console.log(`TokenBridge contracts:`, tokenBridgeContracts);

  // Save token bridge contracts in JSON file
  const tokenBridgeContractsFilePath = saveTokenBridgeContractsFile(tokenBridgeContracts);
  console.log(`TokenBridge contracts written to ${tokenBridgeContractsFilePath}`);

  if (nativeToken == zeroAddress) {
    // set weth gateway

    const maxSubmissionCostForWethGateway = await calculateMaxSubmissionCost(
      parentChainPublicClient,
      dataLengthForWethGateway,
    );

    console.log(`Setting the WETH gateway in the TokenBridge...`);
    console.log('Data length for WETH gateway:', dataLengthForWethGateway);
    console.log(`Max submission cost for WETH gateway: ${maxSubmissionCostForWethGateway}`);

    const setWethGatewayTxRequest = await enqueueTokenBridgePrepareSetWethGatewayTransactionRequest(
      {
        rollup: coreContracts.rollup,
        account: deployer.address,
        rollupDeploymentBlockNumber: BigInt(coreContracts.deployedAtBlockNumber),
        parentChainPublicClient,
        gasLimit: applyBuffer(maxGasForWethGateway),
        maxGasPrice: defaultMaxGasPrice,
        maxSubmissionCost: applyBuffer(maxSubmissionCostForWethGateway),
      },
    );

    // sign and send the transaction
    const setWethGatewayTxHash = await parentChainPublicClient.sendRawTransaction({
      serializedTransaction: await deployer.signTransaction(setWethGatewayTxRequest),
    });

    // get the transaction receipt after waiting for the transaction to complete
    const setWethGatewayTxReceipt = createTokenBridgePrepareSetWethGatewayTransactionReceipt(
      await parentChainPublicClient.waitForTransactionReceipt({ hash: setWethGatewayTxHash }),
    );

    console.log(
      `Weth gateway set in ${getBlockExplorerUrl(parentChainInformation)}/tx/${
        setWethGatewayTxReceipt.transactionHash
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
